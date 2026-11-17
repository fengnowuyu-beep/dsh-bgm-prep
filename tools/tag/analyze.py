"""
CLAP 打标器（v2）：多窗口 + 概念化的多句词表。

输入：
{
  "tracks": [{"song_id": 1, "title": "...", "url": "直链", "expect": ["轻快", "安静钢琴"]}],
  "concepts": [{"label": "轻快", "prompts": ["...", "..."]}, ...],
  "cookie": "完整 cookie（url 为空时兜底）"
}

输出：
{"results": {"<song_id>": {
  "top": [["恐怖配乐", 0.87], ...],   # 整体像什么（对全部概念打分）
  "match": 0.62,                       # 落在 expect 那几个概念上的最高分
  "matchLabel": "紧张悬疑",
  "vocal": 0.22,
  "margin": 0.79
}}}

两个关键改进：
1. 音频取**开头/中间/结尾各 20 秒**，三个向量平均——只听中段会撞上间奏。
2. 每个概念由 3–5 个英文说法平均成一个向量——一句话会把语感锁死。
"""
import io
import json
import os
import sys
import urllib.request

os.environ.setdefault("HF_HOME", r"E:\Software\audioml\models")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

MODEL = "laion/larger_clap_music_and_speech"
VOCAL_PROMPTS = [
    "instrumental music without any singing",
    "music with a person singing or rapping",
]
WINDOW_SECONDS = 20
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

FALLBACK_CONCEPTS = [
    {"label": "器乐", "prompts": ["instrumental music without vocals"]},
    {"label": "轻快", "prompts": ["feel-good upbeat music"]},
]


def headers(cookie=""):
    out = {"user-agent": UA, "referer": "https://music.163.com/"}
    if cookie:
        out["cookie"] = cookie if "=" in cookie else f"MUSIC_U={cookie}"
    return out


def fetch_audio(track, cookie):
    url = str(track.get("url") or "")
    song_id = track.get("song_id")
    candidates = []
    if url:
        candidates.append(("direct", url))
    candidates.append(("outer", f"https://music.163.com/song/media/outer/url?id={song_id}.mp3"))
    last_error = "unknown"
    for label, target in candidates:
        try:
            req = urllib.request.Request(target, headers=headers(cookie))
            with urllib.request.urlopen(req, timeout=60) as resp:
                if label == "outer":
                    ctype = resp.headers.get("content-type", "")
                    if not ctype.startswith("audio/"):
                        last_error = f"outer/url 返回 {ctype or '空类型'}"
                        continue
                return resp.read()
        except Exception as exc:  # noqa: BLE001
            last_error = f"{label}: {type(exc).__name__}: {exc}"
    print(f"[tag] {song_id} 取音频失败：{last_error}", file=sys.stderr)
    return None


def pick_windows(y, sr):
    """开头 / 中间 / 结尾各取一段，避开片头淡入和片尾淡出。"""
    span = sr * WINDOW_SECONDS
    if len(y) <= span:
        return [y]
    tail = max(0, len(y) - span - int(sr * 1.5))
    mid = max(0, (len(y) - span) // 2)
    return [y[:span], y[mid:mid + span], y[tail:tail + span]]


def main():
    job = json.load(sys.stdin)
    tracks = job.get("tracks") or []
    if not tracks:
        json.dump({"results": {}}, sys.stdout)
        return
    cookie = (job.get("cookie") or "").strip()

    concepts = []
    seen = set()
    for item in (job.get("concepts") or FALLBACK_CONCEPTS):
        label = str(item.get("label") or "").strip()
        prompts = [str(p).strip() for p in (item.get("prompts") or []) if str(p).strip()]
        if label == "" or not prompts or label in seen:
            continue
        seen.add(label)
        concepts.append({"label": label, "prompts": prompts})
    if not concepts:
        concepts = FALLBACK_CONCEPTS

    import librosa
    import numpy as np
    import torch
    from transformers import ClapModel, ClapProcessor

    processor = ClapProcessor.from_pretrained(MODEL)
    model = ClapModel.from_pretrained(MODEL).eval()
    scale = model.logit_scale_a.exp().item()

    def embed(output):
        if torch.is_tensor(output):
            return output
        for attr in ("pooler_output", "audio_embeds", "text_embeds", "last_hidden_state"):
            value = getattr(output, attr, None)
            if torch.is_tensor(value):
                return value
        raise TypeError(type(output).__name__)

    def text_embed(texts):
        with torch.no_grad():
            e = embed(model.get_text_features(**processor(text=texts, return_tensors="pt", padding=True)))
        return e / e.norm(dim=-1, keepdim=True)

    # 每个概念：多个说法的向量取平均，再归一化
    concept_matrix = []
    for concept in concepts:
        vecs = text_embed(concept["prompts"]).mean(dim=0)
        concept_matrix.append(vecs / vecs.norm())
    concept_matrix = torch.stack(concept_matrix)

    vocal_matrix = text_embed(VOCAL_PROMPTS)
    label_index = {c["label"]: i for i, c in enumerate(concepts)}

    results = {}
    for track in tracks:
        song_id = track.get("song_id")
        try:
            raw = fetch_audio(track, cookie)
            if not raw or len(raw) < 20000:
                results[str(song_id)] = {"error": "audio unavailable"}
                continue
            y, sr = librosa.load(io.BytesIO(raw), sr=48000, mono=True, duration=180)
            if y.size < sr * 5:
                results[str(song_id)] = {"error": "audio too short"}
                continue

            window_vecs = []
            with torch.no_grad():
                for clip in pick_windows(y, sr):
                    inputs = processor(audio=clip, sampling_rate=48000, return_tensors="pt")
                    vec = embed(model.get_audio_features(**inputs))
                    window_vecs.append(vec / vec.norm(dim=-1, keepdim=True))
            audio = torch.stack(window_vecs).mean(dim=0)
            audio = audio / audio.norm()

            sims = (audio @ concept_matrix.T).squeeze(0) * scale
            probs = sims.softmax(dim=-1).tolist()
            vprobs = ((audio @ vocal_matrix.T).squeeze(0) * scale).softmax(dim=-1).tolist()

            ranked = sorted(zip([c["label"] for c in concepts], probs), key=lambda item: -item[1])[:3]

            expect = [str(label) for label in (track.get("expect") or []) if str(label) in label_index]
            match, match_label = 0.0, ""
            for label in expect:
                score = probs[label_index[label]]
                if score > match:
                    match, match_label = score, label
            if not expect:
                match, match_label = ranked[0][1], ranked[0][0]

            results[str(song_id)] = {
                "top": [[label, round(score, 3)] for label, score in ranked],
                "match": round(match, 3),
                "matchLabel": match_label,
                "vocal": round(vprobs[1], 3),
                "margin": round(ranked[0][1] - ranked[1][1], 3) if len(ranked) > 1 else 1.0,
            }
        except Exception as exc:  # noqa: BLE001
            results[str(song_id)] = {"error": f"{type(exc).__name__}: {exc}"}

    json.dump({"results": results}, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()

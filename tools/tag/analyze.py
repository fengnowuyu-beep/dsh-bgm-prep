"""
CLAP 打标器：读 stdin 的 JSON 任务，输出 JSON 结果到 stdout。

输入：
{
  "tracks": [{"song_id": 123, "title": "...", "url": "已签名的播放直链，可空"}],
  "cookie": "完整 cookie 串（url 为空时的兜底用）"
}

输出：
{"results": {"<song_id>": {"top": [["恐怖配乐", 0.87], ...], "vocal": 0.22, "margin": 0.79}}}
失败的单曲写 {"error": "..."}，不影响其它曲目。

设计约束：不写文件、不实现网易云签名（签名在 Node 侧做，这里只下载），全部靠 stdin/stdout 通信。
"""
import io
import json
import os
import sys
import urllib.request

os.environ.setdefault("HF_HOME", r"E:\Software\audioml\models")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

PROMPTS = [
    "instrumental music without vocals",
    "music with singing vocals",
    "calm gentle piano music",
    "tense suspenseful music",
    "dark ambient drone",
    "epic orchestral music",
    "aggressive intense music",
    "sad melancholic music",
    "feel-good upbeat music",
    "groovy rhythmic dance music",
    "horror soundtrack",
    "acoustic folk music",
]
LABEL = {
    "instrumental music without vocals": "器乐",
    "music with singing vocals": "有人声",
    "calm gentle piano music": "安静钢琴",
    "tense suspenseful music": "紧张悬疑",
    "dark ambient drone": "暗色氛围",
    "epic orchestral music": "史诗管弦",
    "aggressive intense music": "激烈攻击",
    "sad melancholic music": "忧伤",
    "feel-good upbeat music": "轻快",
    "groovy rhythmic dance music": "律动",
    "horror soundtrack": "恐怖配乐",
    "acoustic folk music": "民谣木吉他",
}
VOCAL_PROMPTS = [
    "instrumental music without any singing",
    "music with a person singing or rapping",
]
MODEL = "laion/larger_clap_music_and_speech"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")


def headers(cookie=""):
    out = {"user-agent": UA, "referer": "https://music.163.com/"}
    if cookie:
        out["cookie"] = cookie if "=" in cookie else f"MUSIC_U={cookie}"
    return out


def fetch_audio(track, cookie):
    """优先用 Node 侧换好的直链；没有才自己走匿名/登录兜底。"""
    url = str(track.get("url") or "")
    song_id = track.get("song_id")
    last_error = "unknown"
    candidates = []
    if url:
        candidates.append(("direct", url))
    candidates.append(("outer", f"https://music.163.com/song/media/outer/url?id={song_id}.mp3"))

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


def main():
    job = json.load(sys.stdin)
    tracks = job.get("tracks") or []
    if not tracks:
        json.dump({"results": {}}, sys.stdout)
        return
    cookie = (job.get("cookie") or "").strip()

    import librosa
    import torch
    from transformers import ClapModel, ClapProcessor

    processor = ClapProcessor.from_pretrained(MODEL)
    model = ClapModel.from_pretrained(MODEL).eval()
    text = processor(text=PROMPTS, return_tensors="pt", padding=True)
    text_vocal = processor(text=VOCAL_PROMPTS, return_tensors="pt", padding=True)
    scale = model.logit_scale_a.exp().item()

    def embed(output):
        if torch.is_tensor(output):
            return output
        for attr in ("pooler_output", "audio_embeds", "text_embeds", "last_hidden_state"):
            value = getattr(output, attr, None)
            if torch.is_tensor(value):
                return value
        raise TypeError(type(output).__name__)

    with torch.no_grad():
        text_embed = embed(model.get_text_features(**text))
        text_embed = text_embed / text_embed.norm(dim=-1, keepdim=True)
        vocal_embed = embed(model.get_text_features(**text_vocal))
        vocal_embed = vocal_embed / vocal_embed.norm(dim=-1, keepdim=True)

    results = {}
    for track in tracks:
        song_id = track.get("song_id")
        try:
            raw = fetch_audio(track, cookie)
            if not raw or len(raw) < 20000:
                results[str(song_id)] = {"error": "audio unavailable"}
                continue
            y, sr = librosa.load(io.BytesIO(raw), sr=48000, mono=True, duration=45)
            if y.size < sr * 5:
                results[str(song_id)] = {"error": "audio too short"}
                continue
            mid = max(0, (len(y) - sr * 30) // 2)
            clip = y[mid: mid + sr * 30]
            inputs = processor(audio=clip, sampling_rate=48000, return_tensors="pt")
            with torch.no_grad():
                audio_embed = embed(model.get_audio_features(**inputs))
            audio_embed = audio_embed / audio_embed.norm(dim=-1, keepdim=True)
            probs = ((audio_embed @ text_embed.T).squeeze(0) * scale).softmax(dim=-1).tolist()
            vprobs = ((audio_embed @ vocal_embed.T).squeeze(0) * scale).softmax(dim=-1).tolist()
            ranked = sorted(zip(PROMPTS, probs), key=lambda item: -item[1])[:3]
            results[str(song_id)] = {
                "top": [[LABEL[p], round(s, 3)] for p, s in ranked],
                "vocal": round(vprobs[1], 3),
                "margin": round(ranked[0][1] - ranked[1][1], 3),
            }
        except Exception as exc:  # noqa: BLE001
            results[str(song_id)] = {"error": f"{type(exc).__name__}: {exc}"}

    json.dump({"results": results}, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()

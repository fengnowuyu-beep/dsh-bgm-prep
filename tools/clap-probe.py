"""
CLAP 零样本验证：只回答一个问题——它给出的「有没有人声 / 什么情绪」靠不靠谱。
输入：某份曲目表里已经定选的曲子；输出：每首的 top-3 词条与得分。
不做集成，不写回 cues.json。
"""
import io
import json
import sys
import urllib.request

import librosa
import numpy as np
import torch
from transformers import ClapModel, ClapProcessor

SHEET = r"F:\Data\听枫馆\模组\COC\080天体之音\bgm\tianti.cues.json"
HOST = "http://127.0.0.1:11822"
MODEL = "laion/larger_clap_music_and_speech"

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

# 人声单独做二分类：不在 12 个异质词里比，避免被"安静钢琴"这类强项淹没
VOCAL_PROMPTS = [
    "instrumental music without any singing",
    "music with a person singing or rapping",
]


def _as_tensor(out):
    """transformers 5.x 的 get_*_features 返回的是 ModelOutput，不是裸张量。"""
    if torch.is_tensor(out):
        return out
    for attr in ("pooler_output", "audio_embeds", "text_embeds", "last_hidden_state"):
        value = getattr(out, attr, None)
        if torch.is_tensor(value):
            return value
    raise TypeError(f"无法从 {type(out).__name__} 取出嵌入张量")


def load_audio(song_id):
    url = f"{HOST}/bgm-prep/api/audio?id={song_id}"
    try:
        with urllib.request.urlopen(url, timeout=45) as resp:
            raw = resp.read()
    except Exception as exc:  # noqa: BLE001
        return None, f"{type(exc).__name__}: {exc}"
    if len(raw) < 20000:
        return None, f"body too small ({len(raw)} bytes)"
    try:
        y, sr = librosa.load(io.BytesIO(raw), sr=48000, mono=True, duration=45)
    except Exception as exc:  # noqa: BLE001
        return None, f"decode failed: {type(exc).__name__}: {exc}"
    if y.size < sr * 5:
        return None, "too short"
    # 取中间 30 秒，避开前奏和淡出
    mid = max(0, (len(y) - sr * 30) // 2)
    return y[mid: mid + sr * 30], None


def main():
    sheet = json.load(open(SHEET, encoding="utf-8"))
    picks = []
    for idx, cue in enumerate(sheet["cues"], 1):
        if not cue.get("need_bgm") or not cue.get("picks"):
            continue
        primary = cue["picks"]["primary"]
        cand = next((c for c in cue.get("candidates", []) if c["song_id"] == primary["song_id"]), None)
        if cand is None:
            continue
        picks.append({"no": idx, "scene": cue["scene"], "why": primary.get("why", ""), **cand})

    print(f"待分析 {len(picks)} 首，模型 {MODEL}", file=sys.stderr)
    processor = ClapProcessor.from_pretrained(MODEL)
    model = ClapModel.from_pretrained(MODEL).eval()
    text = processor(text=PROMPTS, return_tensors="pt", padding=True)
    text_vocal = processor(text=VOCAL_PROMPTS, return_tensors="pt", padding=True)
    # CLAP 自带一个可学习的温度；不乘上去 softmax 会被压平成一片 0.09
    scale = model.logit_scale_a.exp().item()
    print(f"logit_scale = {scale:.3f}", file=sys.stderr)

    rows = []
    for item in picks:
        audio, err = load_audio(item["song_id"])
        if audio is None:
            rows.append({"no": item["no"], "title": item["title"], "artist": item["artist"],
                         "scene": item["scene"], "why": item["why"], "error": err})
            print(f"  [{item['no']:02d}] {item['title']} —— 取音频失败: {err}", file=sys.stderr)
            continue
        inputs = processor(audio=audio, sampling_rate=48000, return_tensors="pt")
        with torch.no_grad():
            audio_embed = _as_tensor(model.get_audio_features(**inputs))
            text_embed = _as_tensor(model.get_text_features(**text))
            vocal_embed = _as_tensor(model.get_text_features(**text_vocal))
        audio_embed = audio_embed / audio_embed.norm(dim=-1, keepdim=True)
        text_embed = text_embed / text_embed.norm(dim=-1, keepdim=True)
        vocal_embed = vocal_embed / vocal_embed.norm(dim=-1, keepdim=True)
        sims = (audio_embed @ text_embed.T).squeeze(0) * scale
        probs = sims.softmax(dim=-1).tolist()
        vsims = (audio_embed @ vocal_embed.T).squeeze(0) * scale
        vprobs = vsims.softmax(dim=-1).tolist()
        vocal = vprobs[1]
        ranked = sorted(zip(PROMPTS, probs), key=lambda x: -x[1])[:3]
        margin = ranked[0][1] - ranked[1][1]
        rows.append({
            "no": item["no"], "title": item["title"], "artist": item["artist"],
            "scene": item["scene"], "why": item["why"],
            "vocal_prob": round(vocal, 3),
            "margin": round(margin, 3),
            "top": [(LABEL[p], round(s, 3)) for p, s in ranked],
        })
        print(f"  [{item['no']:02d}] {item['title']}  ok", file=sys.stderr)

    out = r"E:\Data\Project\DeepSeekHarness\DSH-Homemade-Plugins\dsh-bgm-prep\tools\clap-probe.json"
    json.dump({"model": MODEL, "rows": rows}, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"\n写出 {out}")


if __name__ == "__main__":
    main()

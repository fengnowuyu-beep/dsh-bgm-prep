"""music2emo 薄封装：音频 → Jamendo 情绪概率 + valence/arousal。

契约（与 lib/analyze.js 对齐）：
  stdin  { "tracks": [{"song_id": 1, "url": "https://...", "title": "..."}],
           "code": "E:\\Software\\audioml-m2e\\music2emo",
           "models": "E:\\Software\\audioml-m2e\\models" }
  stdout { "results": { "1": { "probs": {"horror": 0.7, ...},
                                "va": {"valence": 2.1, "arousal": 5.8},
                                "stability": null } } }

只做三件事：下载 → 解码成 wav → 调 Music2emo.predict。
不做 UI、不训练、不做和弦以外的额外处理（和弦在 predict 内部完成）。

对上游代码做的两处最小修改（见 docs/DESIGN-v4.md §7.2）：
  1. music2emo.py 里 `import gradio` 改成 try/except —— 插件不需要 UI，也不装 gradio；
  2. 返回值多带一个 `probs`（完整 56 维概率），`predicted_moods` 只有过阈值的 top 列表，不够用。
"""

import io
import json
import os
import sys
import tempfile
import traceback

import numpy as np


def _decode_to_wav(url, out_path, timeout=60):
    """下载音频并转成 24 kHz mono wav。优先 soundfile，失败再试 ffmpeg。"""
    import requests

    headers = {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "referer": "https://music.163.com/",
    }
    resp = requests.get(url, headers=headers, timeout=timeout)
    resp.raise_for_status()
    raw = resp.content
    if len(raw) < 20000:
        raise RuntimeError(f"audio too small ({len(raw)} bytes)")

    tmp = out_path + ".src"
    with open(tmp, "wb") as f:
        f.write(raw)

    import librosa
    import soundfile as sf

    y, sr = librosa.load(tmp, sr=24000, mono=True)
    if y.size < 24000 * 3:
        raise RuntimeError("audio too short")
    sf.write(out_path, y, 24000)
    return out_path


def main():
    job = json.load(sys.stdin)
    code = job["code"]
    tracks = job.get("tracks") or []

    # music2emo 的推理链大量使用相对路径（./inference/data、./temp_out），必须切到仓库目录
    os.chdir(code)
    sys.path.insert(0, code)
    os.environ.setdefault("MERT_MODEL", os.path.join(job.get("models", ""), "MERT-v1-95M"))

    results = {}
    model = None
    try:
        from music2emo import Music2emo

        model = Music2emo(model_weights="saved_models/J_all.ckpt")
        tags = np.load("./inference/data/tag_list.npy", allow_pickle=True)[127:]
        mood_list = [str(t).replace("mood/theme---", "") for t in tags]
    except Exception as exc:  # noqa: BLE001
        json.dump({"error": f"加载 music2emo 失败：{type(exc).__name__}: {exc}",
                   "trace": traceback.format_exc()[-800:]}, sys.stdout, ensure_ascii=False)
        return

    tmp_dir = tempfile.mkdtemp(prefix="m2e-")
    for track in tracks:
        sid = str(track.get("song_id"))
        url = str(track.get("url") or "")
        try:
            if not url:
                raise RuntimeError("no playable url")
            wav = os.path.join(tmp_dir, f"{sid}.wav")
            _decode_to_wav(url, wav)
            out = model.predict(wav)
            probs = out.get("probs") or []
            results[sid] = {
                "probs": {mood_list[i]: round(float(p), 4) for i, p in enumerate(probs) if i < len(mood_list)},
                "va": {
                    "valence": round(float(out.get("valence", 0.0)), 3),
                    "arousal": round(float(out.get("arousal", 0.0)), 3),
                },
                "stability": None,
            }
        except Exception as exc:  # noqa: BLE001
            results[sid] = {"error": f"{type(exc).__name__}: {str(exc)[:160]}"}

    json.dump({"results": results}, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()

"""music2emo 薄封装：音频 → Jamendo 情绪概率 + valence/arousal。

契约（与 lib/analyze.js 对齐）：
  stdin  { "tracks": [{"song_id": 1, "url": "https://...", "title": "..."}],
           "code": "E:\\Software\\audioml-m2e\\music2emo",
           "models": "E:\\Software\\audioml-m2e\\models",
           "cache": {"dir": "...", "version": "music2emo-v1", "max_bytes": 5368709120,
                     "concurrency": 3} }
  stdout NDJSON，一行一首，算完立即 flush：
    {"song_id": 1, "result": {"probs": {"horror": 0.7, ...},
                              "va": {"valence": 2.1, "arousal": 5.8},
                              "stability": null}}
    {"song_id": 2, "result": {"error": "no playable url"}}
    {"done": true, "count": 2}
  致命错误（模型加载失败）输出 {"error": "..."} 后退出。

为什么是 NDJSON：老版把结果攒在内存里、结尾一次 json.dump，进程一被杀就全丢
（2026-11-18 20 分钟跑批全损）。现在每首算完立刻吐一行，lib/analyze.js 收到一行
就写一次 analysis.db，任何中断最多损失当前这一首。

只做三件事：下载 → 解码成 24 kHz mono wav → 调 Music2emo.predict。
不做 UI、不训练、不做和弦以外的额外处理（和弦在 predict 内部完成）。

兼容垫片：music2emo 的 `chord_root.json` 缺 `X`（未知和弦）键，个别音频会触发
`KeyError: 'X'`。本文件在加载 music2emo 后在内存里补这个键，**不修改
`E:\Software\audioml-m2e` 的任何文件**；细节见下方「上游兼容垫片」注释、
README「听感分析」和 `docs/DESIGN-v4.md` §7.2。

对上游代码做的两处最小修改（见 docs/DESIGN-v4.md §7.2）：
  1. music2emo.py 里 `import gradio` 改成 try/except —— 插件不需要 UI，也不装 gradio；
  2. 返回值多带一个 `probs`（完整 56 维概率），`predicted_moods` 只有过阈值的 top 列表，不够用。
"""

import json
import os
import re
import shutil
import sys
import tempfile
import time
import traceback
from concurrent.futures import ThreadPoolExecutor

import numpy as np

CACHE_VERSION_FALLBACK = "music2emo-v1"
MIN_AUDIO_BYTES = 20000
MIN_CACHE_BYTES = 100000

# 人声二分类（CLAP 零样本）：与音乐情绪分开算，只回答「有没有人声」。
# 固定 10 秒窗口 × 6 均匀铺满全曲，取最大概率。
# 为什么不用更长的窗口：CLAP 的 feature extractor 默认 truncation="rand_trunc"，
# 超过 10 秒的输入会被**随机**截取 10 秒，导致同一个文件每次算出来不一样（2026-11-19 实测 0.49–0.75）。
# 固定 10 秒正好是它的窗口长度，不触发随机截断，结果可复现。
VOCAL_PROMPTS = [
    "instrumental music without any singing",
    "music with a person singing or rapping",
]
VOCAL_CLIP_SECONDS = 10
VOCAL_WINDOWS = 6


def _emit(obj):
    """一行一个 JSON，写完立刻 flush —— 这是增量落库的前提。"""
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _safe_token(value):
    text = re.sub(r"[^0-9A-Za-z._-]+", "-", str(value)).strip("-")
    return text or "v"


def _cache_file(cache_dir, song_id, version):
    return os.path.join(cache_dir, f"{int(song_id)}-{_safe_token(version)}.wav")


def _is_complete(path):
    """缓存文件是不是一整个 wav。写入用 os.replace，存在即完整，只防手滑/截断。"""
    try:
        return os.stat(path).st_size >= MIN_CACHE_BYTES
    except OSError:
        return False


def _touch(path):
    try:
        os.utime(path, None)
    except OSError:
        pass


def _fetch_and_decode(url, out_path, timeout=60):
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
    if len(raw) < MIN_AUDIO_BYTES:
        raise RuntimeError(f"audio too small ({len(raw)} bytes)")

    src = out_path + ".src"
    with open(src, "wb") as f:
        f.write(raw)

    try:
        import librosa
        import soundfile as sf

        y, sr = librosa.load(src, sr=24000, mono=True)
        if y.size < 24000 * 3:
            raise RuntimeError("audio too short")
        # .part-<pid> 后缀让 soundfile 猜不出格式，显式指定 WAV
        sf.write(out_path, y, 24000, format="WAV")
    finally:
        try:
            os.remove(src)
        except OSError:
            pass


def _ensure_wav(url, final_path):
    """缓存命中直接返回；否则下载/解码到 <final>.part-<pid>，再原子替换。"""
    if _is_complete(final_path):
        _touch(final_path)
        return final_path
    os.makedirs(os.path.dirname(final_path), exist_ok=True)
    part = f"{final_path}.part-{os.getpid()}"
    try:
        _fetch_and_decode(url, part)
        os.replace(part, final_path)
    finally:
        for leftover in (part, part + ".src"):
            try:
                os.remove(leftover)
            except OSError:
                pass
    _touch(final_path)
    return final_path


def _clean_stale_parts(cache_dir, max_age=3600):
    """清掉上次被 kill 留下的 .part-*（老的才删，避免误删并发任务正在写的）。"""
    now = time.time()
    try:
        names = os.listdir(cache_dir)
    except OSError:
        return
    for name in names:
        if ".part-" not in name:
            continue
        path = os.path.join(cache_dir, name)
        try:
            if now - os.stat(path).st_mtime > max_age:
                os.remove(path)
        except OSError:
            continue


def _enforce_cache(cache_dir, max_bytes):
    """容量上限，按 mtime 淘汰最久没用的 wav。返回删掉几个。"""
    if not cache_dir or max_bytes <= 0:
        return 0
    entries = []
    total = 0
    try:
        names = os.listdir(cache_dir)
    except OSError:
        return 0
    for name in names:
        if not name.endswith(".wav"):
            continue
        path = os.path.join(cache_dir, name)
        try:
            st = os.stat(path)
        except OSError:
            continue
        entries.append((st.st_mtime, st.st_size, path))
        total += st.st_size
    removed = 0
    for _, size, path in sorted(entries):
        if total <= max_bytes:
            break
        try:
            os.remove(path)
            total -= size
            removed += 1
        except OSError:
            continue
    return removed


# ---------------------------------------------------------------- 上游兼容垫片
#
# 上游 bug（E:\Software\audioml-m2e\music2emo\music2emo.py:424-426）：
#     chordRootID = chordRootDic[chord_arr[0]]       # X 在这里先被查表
#     if chord_arr[0] == "N" or chord_arr[0] == "X": # 本意兼容 N/X，但判断晚了一步
#         chordAttrID = 0
# chord_root.json 只有 N + 12 个根音（N=0），没有 X；而 BTC 词表里 X 是合法的
# 第 168 类（utils/mir_eval_modules.py: idx2voca_chord()[168] = "X"，
# 169 = "N"）。所以只要音频里出现一段「未知和弦」，predict 就会抛
# KeyError: 'X'。这是确定性的，同一首歌重试必然复现。
#
# 修法选择：**不修改 E:\Software\audioml-m2e 的任何文件**，只在当前分析进程内
# 把 music2emo 模块的 json 换成 _JsonWithUnknownChordRoot：读到 chord_root.json
# 时在内存里补一个 "X": N 的 ID。X 这个和弦类仍然保留（chord.json 本来就有 X），
# 下游 chordAttrID=0 的分支照常走；只是补上了缺的根音兜底。
# 上游以后自己修了也没关系：检测到已有 X 就不再补，垫片自动无害。
# 说明同步在 README「听感分析」和 docs/DESIGN-v4.md §7.2。

CHORD_ROOT_SUFFIX = "inference/data/chord_root.json"
_shim_logged = False


def _inject_unknown_chord_root(data, name):
    """在内存里给 chord_root.json 补 X → N 的根音 ID；不写磁盘。"""
    global _shim_logged
    if not isinstance(data, dict):
        return data
    path = str(name or "").replace("\\", "/")
    if not path.endswith(CHORD_ROOT_SUFFIX):
        return data
    if "X" not in data:
        data["X"] = data.get("N", 0)
        if not _shim_logged:
            _shim_logged = True
            sys.stderr.write(
                "[bgm-prep] music2emo chord_root.json 缺 X；已在内存补 N 的 ID"
                "（不修改 E:\\Software\\audioml-m2e，见 docs/DESIGN-v4.md §7.2）\n"
            )
            sys.stderr.flush()
    return data


class _JsonWithUnknownChordRoot:
    """music2emo 模块专用的 json 代理：只拦 chord_root.json，其他全部透传。"""

    def __getattr__(self, name):
        return getattr(json, name)

    def load(self, fp, *args, **kwargs):
        data = json.load(fp, *args, **kwargs)
        return _inject_unknown_chord_root(data, getattr(fp, "name", ""))


def _clap_local_path(hf_home, repo):
    """优先用本地缓存里的快照目录，绕开 huggingface_hub 的联网解析。"""
    if not hf_home:
        return ""
    repo_dir = os.path.join(hf_home, "hub", "models--" + str(repo).replace("/", "--"))
    try:
        with open(os.path.join(repo_dir, "refs", "main"), "r", encoding="utf-8") as ref:
            rev = ref.read().strip()
    except OSError:
        return ""
    if not rev:
        return ""
    snap = os.path.join(repo_dir, "snapshots", rev)
    return snap if os.path.isfile(os.path.join(snap, "config.json")) else ""


def _load_clap(cfg):
    """加载 CLAP 只做「有没有人声」二分类；失败返回 None，不阻塞主流程。"""
    import torch
    from transformers import ClapModel, ClapProcessor

    hf_home = str(cfg.get("hfHome") or "").strip()
    if hf_home:
        os.environ["HF_HOME"] = hf_home
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    name = str(cfg.get("model") or "laion/larger_clap_music_and_speech")
    target = _clap_local_path(hf_home, name) or name
    try:
        processor = ClapProcessor.from_pretrained(target, local_files_only=True)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model = ClapModel.from_pretrained(target, local_files_only=True).to(device).eval()
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(f"[bgm-prep] CLAP 加载失败，跳过人声识别：{type(exc).__name__}: {exc}\n")
        sys.stderr.flush()
        return None
    text = processor(text=VOCAL_PROMPTS, return_tensors="pt", padding=True)
    with torch.no_grad():
        text_embed = model.get_text_features(**{k: v.to(device) for k, v in text.items()})
    text_embed = text_embed / text_embed.norm(dim=-1, keepdim=True)
    return (processor, model, text_embed, float(model.logit_scale_a.exp().item()), device)


def _vocal_prob(wav_path, clap):
    """固定 10 秒窗口 × 6（均匀铺满全曲）里最大的人声概率；确定性结果。"""
    import librosa
    import soundfile as sf
    import torch

    processor, model, text_embed, scale, device = clap
    data, sr = sf.read(wav_path, dtype="float32")
    if data.ndim > 1:
        data = data.mean(axis=1)
    duration = len(data) / sr
    span = min(VOCAL_CLIP_SECONDS, duration)
    if span < 3:
        return None
    if duration <= span:
        starts = [0.0]
    else:
        step = (duration - span) / max(1, VOCAL_WINDOWS - 1)
        starts = [round(i * step, 3) for i in range(VOCAL_WINDOWS)]
    max_samples = int(VOCAL_CLIP_SECONDS * 48000)
    best = 0.0
    for start in starts:
        clip = data[int(start * sr): int(start * sr) + int(span * sr)]
        if clip.size == 0:
            continue
        if sr != 48000:
            clip = librosa.resample(clip, orig_sr=sr, target_sr=48000)
        # 必须 ≤ CLAP 的 10 秒窗口：多一个样本就会被 rand_trunc 随机截，结果就不可复现了
        if clip.size > max_samples:
            clip = clip[:max_samples]
        inputs = processor(audios=clip, sampling_rate=48000, return_tensors="pt")
        inputs = {k: v.to(device) for k, v in inputs.items()}
        with torch.no_grad():
            audio_embed = model.get_audio_features(**inputs)
        audio_embed = audio_embed / audio_embed.norm(dim=-1, keepdim=True)
        prob = ((audio_embed @ text_embed.T).squeeze(0) * scale).softmax(dim=-1).tolist()[1]
        best = max(best, float(prob))
    return round(best, 4)


def _load_model(job):
    code = job["code"]
    # music2emo 的推理链大量使用相对路径（./inference/data、./temp_out），必须切到仓库目录
    os.chdir(code)
    sys.path.insert(0, code)
    os.environ.setdefault("MERT_MODEL", os.path.join(job.get("models", ""), "MERT-v1-95M"))

    import torch

    try:
        threads = int(os.environ.get("M2E_THREADS", "16"))
    except ValueError:
        threads = 16
    if threads > 0:
        torch.set_num_threads(threads)

    from music2emo import Music2emo
    import music2emo as _m2e

    # 运行期垫片：见本文件上方「上游兼容垫片」注释；不改上游文件
    _m2e.json = _JsonWithUnknownChordRoot()

    model = Music2emo(model_weights="saved_models/J_all.ckpt")
    tags = np.load("./inference/data/tag_list.npy", allow_pickle=True)[127:]
    mood_list = [str(t).replace("mood/theme---", "") for t in tags]
    return model, mood_list


def _cleanup(cache_dir, cache_max_bytes, tmp_dir):
    """容量淘汰放在整批之后：避免删掉正在排队推理的 wav；临时目录直接删。"""
    if cache_dir and cache_max_bytes > 0:
        _enforce_cache(cache_dir, cache_max_bytes)
    if tmp_dir:
        try:
            shutil.rmtree(tmp_dir)
        except OSError as exc:
            # 清理失败就保留，并把路径说清楚，方便事后手删
            sys.stderr.write(f"temp dir left behind: {tmp_dir} ({exc})\n")
            sys.stderr.flush()


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass

    job = json.load(sys.stdin)
    tracks = job.get("tracks") or []
    mode = str(job.get("mode") or "full")
    vocal_cfg = job.get("vocal") or {}
    vocal_enabled = bool(vocal_cfg.get("enabled"))
    cache_cfg = job.get("cache") or {}
    cache_dir = str(cache_cfg.get("dir") or "").strip()
    cache_version = str(cache_cfg.get("version") or CACHE_VERSION_FALLBACK)
    try:
        cache_max_bytes = int(cache_cfg.get("max_bytes") or 0)
    except (TypeError, ValueError):
        cache_max_bytes = 0

    try:
        download_concurrency = int(cache_cfg.get("concurrency") or 3)
    except (TypeError, ValueError):
        download_concurrency = 3
    download_concurrency = max(1, min(8, download_concurrency))

    tmp_dir = ""
    if cache_dir:
        os.makedirs(cache_dir, exist_ok=True)
        _clean_stale_parts(cache_dir)
    else:
        # 没有缓存目录（老调用/测试）：用临时目录，跑完删掉
        tmp_dir = tempfile.mkdtemp(prefix="m2e-")

    def prepare(track):
        """下载/解码一首到缓存（或临时目录）；缓存命中直接返回路径。"""
        sid = track.get("song_id")
        url = str(track.get("url") or "")
        if cache_dir:
            final = _cache_file(cache_dir, sid, cache_version)
            if _is_complete(final):
                _touch(final)
                return final
            if not url:
                raise RuntimeError("no playable url")
            return _ensure_wav(url, final)
        if not url:
            raise RuntimeError("no playable url")
        wav = os.path.join(tmp_dir, f"{int(sid)}.wav")
        _fetch_and_decode(url, wav)
        return wav

    # 单独的人声批次：只跑 CLAP，不重复 music2emo（给存量分析补 vocal 用）
    if mode == "vocal":
        clap = _load_clap(vocal_cfg) if vocal_enabled else None
        if clap is None:
            _emit({"error": "人声识别不可用（CLAP 没加载起来）"})
            _cleanup(cache_dir, cache_max_bytes, tmp_dir)
            return
        count = 0
        pool = ThreadPoolExecutor(max_workers=download_concurrency)
        try:
            futures = [pool.submit(prepare, track) for track in tracks]
            for index, track in enumerate(tracks):
                sid = track.get("song_id")
                try:
                    wav = futures[index].result()
                    _emit({"song_id": sid, "vocal": _vocal_prob(wav, clap)})
                except Exception as exc:  # noqa: BLE001
                    _emit({"song_id": sid, "error": f"{type(exc).__name__}: {str(exc)[:160]}"})
                count += 1
            _emit({"done": True, "count": count})
        finally:
            pool.shutdown(wait=False, cancel_futures=True)
            _cleanup(cache_dir, cache_max_bytes, tmp_dir)
        return

    try:
        model, mood_list = _load_model(job)
    except Exception as exc:  # noqa: BLE001
        _emit({"error": f"加载 music2emo 失败：{type(exc).__name__}: {exc}",
               "trace": traceback.format_exc()[-800:]})
        return
    clap = None
    if vocal_enabled:
        clap = _load_clap(vocal_cfg)

    count = 0
    pool = ThreadPoolExecutor(max_workers=download_concurrency)
    try:
        # F5：下载/解码并发跑，推理仍按顺序。第一批的下载会被模型加载/推理盖住，
        # 后面的歌则在上一首推理时就已经落到缓存里。
        futures = [pool.submit(prepare, track) for track in tracks]
        for index, track in enumerate(tracks):
            sid = track.get("song_id")
            try:
                wav = futures[index].result()
                out = model.predict(wav)
                probs = out.get("probs") or []
                _emit({
                    "song_id": sid,
                    "result": {
                        "probs": {mood_list[i]: round(float(p), 4)
                                  for i, p in enumerate(probs) if i < len(mood_list)},
                        "va": {
                            "valence": round(float(out.get("valence", 0.0)), 3),
                            "arousal": round(float(out.get("arousal", 0.0)), 3),
                        },
                        "stability": None,
                        "vocal": _vocal_prob(wav, clap) if clap else None,
                    },
                })
            except Exception as exc:  # noqa: BLE001
                _emit({"song_id": sid, "result": {"error": f"{type(exc).__name__}: {str(exc)[:160]}"}})
            count += 1
        _emit({"done": True, "count": count})
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
        _cleanup(cache_dir, cache_max_bytes, tmp_dir)


if __name__ == "__main__":
    main()

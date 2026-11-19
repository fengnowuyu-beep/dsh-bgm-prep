# -*- coding: utf-8 -*-
"""听感分析的「音质 × 取样方案」基准测量。

只负责测：下载 / 解码 / 推理 / 人声 四段耗时 + 得分 + top5。
渲染成 HTML 的活儿在 scripts/benchmark.mjs，这边只吐 JSON。

用法（一般由 scripts/benchmark.mjs 调起）：
    python tools/m2e/benchmark.py --job <job.json> --out <result.json>

job 形状：
    { "song": {"id": 1303708, "title": "...", "duration": 291},
      "cue": {"id": "s2", "target": [{"tag": "dark", "weight": 0.4}, ...]},
      "urls": {"standard": "https://...", "high": "...", "lossless": "..."},
      "code": "...", "models": "...", "hfHome": "..." }
"""
import argparse
import importlib.util
import json
import os
import shutil
import tempfile
import time
import urllib.request

import librosa
import numpy as np
import soundfile as sf

QUALITIES = [('standard', '128k', 'MP3 128k'), ('high', '320k', 'MP3 320k'), ('lossless', '无损', 'FLAC 无损')]
SCHEMES = [('full', '整首'), ('120', '前 120s'), ('60', '前 60s'), ('3x10', '10/50/90 各 10s')]
HERE = os.path.dirname(os.path.abspath(__file__))


def load_analyze_module():
    path = os.path.join(HERE, 'analyze.py')
    spec = importlib.util.spec_from_file_location('m2e_analyze', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def download(url, timeout=180):
    req = urllib.request.Request(url, headers={
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'referer': 'https://music.163.com/'
    })
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
    return raw, (time.perf_counter() - t0) * 1000


def slice_audio(y, sr, kind):
    dur = len(y) / sr
    ten = 10
    if kind == 'full':
        return y
    if kind == '120':
        return y[:int(120 * sr)]
    if kind == '60':
        return y[:int(60 * sr)]
    starts = [min(max(0.0, dur * r), max(0.0, dur - ten)) for r in (0.10, 0.50, 0.90)]
    return np.concatenate([y[int(s * sr): int((s + ten) * sr)] for s in starts])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--job', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()

    job = json.load(open(args.job, encoding='utf-8'))
    os.environ['M2E_THREADS'] = str(job.get('threads') or 16)
    os.environ.setdefault('HF_HOME', job.get('hfHome') or '')
    os.environ.setdefault('HF_HUB_OFFLINE', '1')
    os.environ.setdefault('TRANSFORMERS_OFFLINE', '1')

    m = load_analyze_module()
    target = job['cue']['target']

    t0 = time.perf_counter()
    model, mood_list = m._load_model({'code': job['code'], 'models': job['models']})
    load_mert = (time.perf_counter() - t0) * 1000
    t0 = time.perf_counter()
    clap = m._load_clap({'enabled': True, 'model': 'laion/larger_clap_music_and_speech', 'hfHome': job.get('hfHome')})
    load_clap = (time.perf_counter() - t0) * 1000
    print(f'模型加载：MERT {load_mert:.0f}ms + CLAP {load_clap:.0f}ms', flush=True)

    def flat_of(res):
        probs = [float(p) for p in (res.get('probs') or [])]
        return {mood_list[i]: probs[i] for i in range(min(len(probs), len(mood_list)))}

    def score_of(flat):
        return sum(float(flat.get(t['tag'], 0.0)) * float(t['weight']) for t in target)

    def cosine(a, b):
        keys = sorted(set(a) | set(b))
        va = np.array([a.get(k, 0.0) for k in keys], dtype=np.float64)
        vb = np.array([b.get(k, 0.0) for k in keys], dtype=np.float64)
        na, nb = np.linalg.norm(va), np.linalg.norm(vb)
        return float(va.dot(vb) / (na * nb)) if na and nb else 0.0

    tmp = tempfile.mkdtemp(prefix='m2e-bench-')
    rows = []
    base_flat = None
    try:
        for qkey, qlabel, qname in QUALITIES:
            url = job['urls'].get(qkey) or ''
            if not url:
                print(f'[{qlabel}] 没有直链，跳过', flush=True)
                continue
            raw, dl_ms = download(url)
            src = os.path.join(tmp, f'{qkey}.bin')
            open(src, 'wb').write(raw)
            t0 = time.perf_counter()
            y, sr = librosa.load(src, sr=24000, mono=True)
            dec_ms = (time.perf_counter() - t0) * 1000
            print(f'[{qlabel}] {len(raw)/1048576:.2f}MB 下载 {dl_ms:.0f}ms，解码 {dec_ms:.0f}ms → {len(y)/sr:.1f}s', flush=True)

            for skey, slabel in SCHEMES:
                audio = slice_audio(y, sr, skey)
                wav = os.path.join(tmp, f'{qkey}-{skey}.wav')
                sf.write(wav, audio, sr, format='WAV')
                t0 = time.perf_counter()
                res = model.predict(wav)
                pred_ms = (time.perf_counter() - t0) * 1000
                t0 = time.perf_counter()
                vocal = m._vocal_prob(wav, clap) if clap else None
                voc_ms = (time.perf_counter() - t0) * 1000
                flat = flat_of(res)
                if base_flat is None:
                    base_flat = flat
                rows.append({
                    'quality': qkey, 'qualityLabel': qlabel, 'qualityName': qname,
                    'scheme': skey, 'schemeLabel': slabel,
                    'bytesMB': round(len(raw) / 1048576, 2),
                    'downloadMs': round(dl_ms), 'decodeMs': round(dec_ms),
                    'predictMs': round(pred_ms), 'vocalMs': round(voc_ms),
                    'audioSec': round(len(audio) / sr, 1),
                    'vocalP': None if vocal is None else round(float(vocal), 4),
                    'score': round(score_of(flat), 4),
                    'top': [[k, round(v, 4)] for k, v in sorted(flat.items(), key=lambda kv: -kv[1])[:5]],
                    'probs': {k: round(v, 4) for k, v in flat.items()},
                })
                print(f'  {slabel:14s} 推理 {pred_ms:6.0f}ms 人声 {voc_ms:5.0f}ms 得分 {rows[-1]["score"]:.3f}', flush=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    if not rows:
        raise SystemExit('没有任何测量结果')

    base = next((r for r in rows if r['quality'] == 'lossless' and r['scheme'] == 'full'), rows[0])
    for r in rows:
        r['totalMs'] = r['downloadMs'] + r['decodeMs'] + r['predictMs'] + r['vocalMs']
        r['dScore'] = round(r['score'] - base['score'], 4)
        r['cosine'] = round(cosine(r['probs'], base['probs']), 4)
        r['top1Match'] = r['top'][0][0] == base['top'][0][0]

    payload = {
        'generatedAt': time.strftime('%Y-%m-%d %H:%M'),
        'song': job['song'],
        'cue': job['cue'],
        'base': {'quality': base['quality'], 'scheme': base['scheme']},
        'loadMs': {'mert': round(load_mert), 'clap': round(load_clap)},
        'qualities': [{'key': k, 'label': l, 'name': n} for k, l, n in QUALITIES],
        'schemes': [{'key': k, 'label': l} for k, l in SCHEMES],
        'rows': rows,
    }
    json.dump(payload, open(args.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'\n基准（{base["qualityLabel"]} × {base["schemeLabel"]}）得分 {base["score"]:.3f}')
    print(f'结果：{args.out}')


if __name__ == '__main__':
    main()

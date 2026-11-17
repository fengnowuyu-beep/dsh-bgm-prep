// 听感分析：调 music2emo（E 盘独立环境），结果按歌缓存。
//
// 契约（与 tools/m2e/analyze.py 对齐）：
//   输入 { tracks:[{song_id,title,url}], models, code }
//   输出 { results: { "<song_id>": { probs:{tag:p}, va:{valence,arousal}, stability, error? } } }
//
// 分析是「按歌」的，与场景无关：同一首歌出现在三段，只算一次。

import { spawn } from 'node:child_process'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ncm from './ncm.js'
import { readCookie } from './cookie.js'
import { songUrl } from './netease.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_SCRIPT = path.join(HERE, '..', 'tools', 'm2e', 'analyze.py')

const DEFAULTS = {
  engine: 'music2emo',
  python: 'E:\\Software\\audioml-m2e\\Scripts\\python.exe',
  code: 'E:\\Software\\audioml-m2e\\music2emo',
  models: 'E:\\Software\\audioml-m2e\\models',
  script: DEFAULT_SCRIPT,
  version: 'music2emo-v1',
  timeoutMs: 1200000
}

export async function engineConfig() {
  let saved = {}
  try {
    const raw = JSON.parse(await fsp.readFile(path.join(ncm.dataDir(), 'settings.json'), 'utf8'))
    saved = raw?.analysis ?? {}
  } catch { /* 没配置用默认 */ }
  return { ...DEFAULTS, ...saved, script: saved.script ?? DEFAULT_SCRIPT }
}

export async function engineHealth() {
  const config = await engineConfig()
  const exists = (p) => fsp.stat(p).then(() => true, () => false)
  const checks = [
    { name: 'python', ok: await exists(config.python), path: config.python },
    { name: 'music2emo 代码', ok: await exists(config.code), path: config.code },
    { name: '模型目录', ok: await exists(config.models), path: config.models },
    { name: 'analyze.py', ok: await exists(config.script), path: config.script }
  ]
  return { ...config, ok: checks.every((c) => c.ok), checks }
}

export function cacheFile(songId, version) {
  return path.join(ncm.dataDir(), 'cache', 'analysis', `${songId}-${version}.json`)
}

async function readCache(songId, version) {
  try {
    return JSON.parse(await fsp.readFile(cacheFile(songId, version), 'utf8'))
  } catch {
    return null
  }
}

async function writeCache(songId, version, payload) {
  const file = cacheFile(songId, version)
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await ncm.atomicWrite(file, JSON.stringify(payload, null, 2) + '\n')
}

/** 并发把 id 换成播放直链（拿不到就留空，让 Python 端报错）。 */
async function resolveUrls(tracks, cookie, concurrency = 4) {
  const out = tracks.map((t) => ({ song_id: Number(t.song_id), title: t.title ?? '', url: '' }))
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, out.length) }, async () => {
    while (cursor < out.length) {
      const item = out[cursor++]
      try {
        const resolved = await songUrl(item.song_id, cookie)
        item.url = resolved.url ?? ''
      } catch { /* 留空 */ }
    }
  })
  await Promise.all(workers)
  return out
}

/**
 * 分析一批曲子。已缓存的直接返回，不重复调 Python。
 * @param {{song_id:number,title?:string}[]} tracks
 * @param {{force?:boolean}} options
 */
export async function analyzeTracks(tracks, options = {}) {
  const config = await engineConfig()
  if (config.engine !== 'music2emo') {
    return { ok: false, error: `当前分析引擎是「${config.engine}」，本模块只实现了 music2emo` }
  }
  if (tracks.length === 0) return { ok: true, results: {}, cached: 0, analyzed: 0 }

  const results = {}
  const pending = []
  for (const track of tracks) {
    const hit = options.force ? null : await readCache(track.song_id, config.version)
    if (hit && !hit.error) { results[String(track.song_id)] = hit; continue }
    pending.push(track)
  }
  if (pending.length === 0) {
    return { ok: true, results, cached: Object.keys(results).length, analyzed: 0 }
  }

  const health = await engineHealth()
  if (!health.ok) {
    return { ok: false, error: 'music2emo 环境不完整', checks: health.checks, hint: '按 docs/DESIGN-v4.md §7.2 安装，或改 settings.json 的 analysis 段' }
  }

  const cookie = await readCookie()
  const withUrls = await resolveUrls(pending, cookie)
  const job = JSON.stringify({ tracks: withUrls, models: config.models, code: config.code })
  const env = {
    ...process.env,
    HF_HOME: config.models,
    PYTHONIOENCODING: 'utf-8',
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost'
  }

  const run = await new Promise((resolve) => {
    const child = spawn(config.python, [config.script], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (payload) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(payload)
    }
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* ignore */ }
      finish({ ok: false, error: `分析超时（${Math.round(config.timeoutMs / 1000)}s）` })
    }, config.timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => finish({ ok: false, error: `启动分析进程失败：${error.message}` }))
    child.on('close', (code) => {
      if (settled) return
      const text = stdout.trim()
      if (text === '') {
        finish({ ok: false, error: `分析进程退出（code ${code}）且没有输出：${stderr.trim().slice(0, 300)}` })
        return
      }
      try {
        const parsed = JSON.parse(text.slice(text.indexOf('{')))
        if (parsed.error) finish({ ok: false, error: parsed.error })
        else finish({ ok: true, results: parsed.results ?? {} })
      } catch (error) {
        finish({ ok: false, error: `分析输出无法解析：${error.message}｜${stderr.trim().slice(0, 200)}` })
      }
    })
    try { child.stdin.end(job) } catch { /* close 事件会给出结论 */ }
  })

  if (!run.ok) return run
  let analyzed = 0
  for (const [key, value] of Object.entries(run.results)) {
    if (value?.error) {
      results[key] = { error: String(value.error).slice(0, 160), at: new Date().toISOString() }
      continue
    }
    const payload = {
      probs: value.probs ?? null,
      va: value.va ?? null,
      stability: Number.isFinite(Number(value.stability)) ? Number(value.stability) : null,
      engine: config.version,
      at: new Date().toISOString()
    }
    results[key] = payload
    await writeCache(key, config.version, payload)
    analyzed += 1
  }
  return { ok: true, results, cached: Object.keys(results).length - analyzed, analyzed }
}

/** 把结果写回候选的 analysis 字段。返回写入条数。 */
export function applyAnalysis(cues, results) {
  let written = 0
  for (const cue of cues) {
    for (const candidate of cue.candidates ?? []) {
      const hit = results[String(candidate.song_id)]
      if (!hit) continue
      if (hit.error) {
        candidate.analysis = { error: String(hit.error).slice(0, 100), engine: 'music2emo', at: new Date().toISOString() }
        written += 1
        continue
      }
      candidate.analysis = {
        probs: hit.probs ?? null,
        va: hit.va ?? null,
        vocal: null, // music2emo 不输出人声概率；留字段给后续模型
        stability: hit.stability ?? null,
        engine: hit.engine ?? '',
        at: hit.at ?? new Date().toISOString()
      }
      written += 1
    }
  }
  return written
}

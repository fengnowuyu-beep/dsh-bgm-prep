// 听感分析：调 music2emo（E 盘独立环境），结果按歌缓存。
//
// 契约（与 tools/m2e/analyze.py 对齐）：
//   stdin  { tracks:[{song_id,title,url}], models, code,
//            cache:{dir,version,max_bytes,concurrency} }
//   stdout NDJSON，一行一首：
//     {"song_id":1,"result":{"probs":{...},"va":{...},"stability":null}}
//     {"song_id":2,"result":{"error":"..."}}
//     {"done":true,"count":2}
//   老版「结尾一个 {"results":{...}}」也认，作为兜底。
//
// 每收到一行就写一次 analysis.db。旧版要等子进程退出才落库，20 分钟一超时全丢；
// 现在任何中断最多损失当前这一首。
//
// 超时分两层：
//   perSongTimeoutMs  单首卡死只放弃这一首（kill 后带着剩下的歌重开一批）
//   totalBudgetMs     整次调用到点优雅收尾，保留已落库部分，返回 partial
//
// 分析是「按歌」的，与场景无关：同一首歌出现在三段，只算一次。

import { spawn } from 'node:child_process'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ncm from './ncm.js'
import { readCookie } from './cookie.js'
import { songUrl } from './netease.js'
import { available as analysisDbAvailable, clearFailure, readAnalysis, readFailure, recordFailure, updateVocal, writeAnalysis } from './analysisDb.js'
import { finiteOrNull } from './num.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_SCRIPT = path.join(HERE, '..', 'tools', 'm2e', 'analyze.py')
const GIB = 1024 * 1024 * 1024

const DEFAULTS = {
  engine: 'music2emo',
  python: 'E:\\Software\\audioml-m2e\\Scripts\\python.exe',
  code: 'E:\\Software\\audioml-m2e\\music2emo',
  models: 'E:\\Software\\audioml-m2e\\models',
  script: DEFAULT_SCRIPT,
  version: 'music2emo-v1',
  // 单首卡死的上界：只放弃这一首，继续后面的
  perSongTimeoutMs: 180000,
  // 连续失败这么多首就熔断本次调用，别在音源抖动期空转到预算耗尽
  breakerLimit: 8,
  // 只分析开头这么长的一段：整曲分析对情绪判断没有额外收益，
  // 但下载 + 解码 + 推理的成本是线性的（250~560 秒的歌差 3~5 倍）。
  clipSeconds: 120,
  // 整次调用的硬上限；实际预算按首数推导，见 deriveBudgetMs()
  totalBudgetMs: 90 * 60 * 1000,
  // 每批 spawn 一次 analyze.py：单次超时的损失上界就是一批
  batchSize: 8,
  // 纯 CPU 兜底路径用满物理核；上 GPU 后基本失效
  threads: 16,
  // 音频缓存（24 kHz mono wav，约 12 MB/首），LRU 淘汰
  audioCacheMaxBytes: 5 * GIB,
  // 下载/解码并发数：与推理重叠，下载慢时也不会把整批拖成串行
  downloadConcurrency: 3,
  // 人声识别：CLAP 零样本二分类（「器乐」vs「有人在唱」），跑在 music2emo 同一进程里。
  // penalty / threshold 是打分端参数；enabled=false 时既不探测也不惩罚。
  vocal: {
    enabled: true,
    model: 'laion/larger_clap_music_and_speech',
    hfHome: 'E:\\Software\\audioml\\models',
    penalty: 0.6,
    threshold: 0.1
  }
}

export async function engineConfig() {
  let saved = {}
  try {
    const raw = JSON.parse(await fsp.readFile(path.join(ncm.dataDir(), 'settings.json'), 'utf8'))
    saved = raw?.analysis ?? {}
  } catch { /* 没配置用默认 */ }
  const merged = { ...DEFAULTS, ...saved, script: saved.script ?? DEFAULT_SCRIPT }
  // vocal 是嵌套对象，浅合并会把默认的 model/hfHome 一起覆盖掉
  merged.vocal = { ...DEFAULTS.vocal, ...(saved.vocal ?? {}) }
  // 兼容 0.10 及以前的 analysis.timeoutMs：当作总预算硬上限
  if (saved.totalBudgetMs === undefined && Number.isFinite(Number(saved.timeoutMs)) && Number(saved.timeoutMs) > 0) {
    merged.totalBudgetMs = Number(saved.timeoutMs)
  }
  return merged
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

/** 旧版 JSON 缓存路径：库不可用时写它，也用于首跑时把存量结果迁进数据库。 */
export function legacyCacheFile(songId, version) {
  return path.join(ncm.dataDir(), 'cache', 'analysis', `${songId}-${version}.json`)
}

export function audioCacheDir() {
  return path.join(ncm.dataDir(), 'cache', 'audio')
}

async function readLegacyCache(songId, version) {
  try {
    return JSON.parse(await fsp.readFile(legacyCacheFile(songId, version), 'utf8'))
  } catch {
    return null
  }
}

async function writeLegacyCache(songId, version, payload) {
  try {
    await ncm.atomicWrite(legacyCacheFile(songId, version), JSON.stringify(payload, null, 2))
    return true
  } catch {
    return false
  }
}

function clampInt(value, min, max, fallback) {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

/**
 * 本次调用的总预算：
 *   min(perSongTimeoutMs × 本次首数 × 1.5, totalBudgetMs)
 * n 用「本次请求首数」而不是「待分析首数」——缓存命中不该把预算压到不够单首用。
 */
export function deriveBudgetMs(count, config = {}) {
  const perSong = clampInt(config.perSongTimeoutMs, 1000, 3600000, DEFAULTS.perSongTimeoutMs)
  const cap = clampInt(config.totalBudgetMs, 1000, 24 * 3600000, DEFAULTS.totalBudgetMs)
  const n = Math.max(1, Number(count) || 1)
  return Math.min(Math.ceil(perSong * 1.5 * n), cap)
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

/** 尽量把一行解析成 JSON；容忍库/模型往 stdout 打的噪音前缀。 */
function parseJsonLine(text) {
  try { return JSON.parse(text) } catch { /* 再试一次 */ }
  const start = text.indexOf('{')
  if (start > 0) {
    try { return JSON.parse(text.slice(start)) } catch { /* 不是 JSON */ }
  }
  return null
}

/**
 * 跑一个子进程，按行收结果。
 * 超时/预算到点会 kill 子进程；已经收到的行不会被丢弃。
 */
function runChild(queue, { config, budgetMs, perSongTimeoutMs, storeOk, mode = 'full' }) {
  return new Promise((resolve) => {
    const vocalEnabled = config.vocal?.enabled !== false
    const hfHome = mode === 'vocal' || vocalEnabled
      ? (config.vocal?.hfHome || config.models)
      : config.models
    const env = {
      ...process.env,
      HF_HOME: hfHome,
      PYTHONIOENCODING: 'utf-8',
      M2E_THREADS: String(clampInt(config.threads, 1, 64, DEFAULTS.threads)),
      OMP_NUM_THREADS: String(clampInt(config.threads, 1, 64, DEFAULTS.threads)),
      MKL_NUM_THREADS: String(clampInt(config.threads, 1, 64, DEFAULTS.threads)),
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost',
      // CLAP 权重在本地缓存里，断网也能加载；不设 offline 会卡在连 HuggingFace
      ...(vocalEnabled || mode === 'vocal' ? { HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' } : {})
    }
    const job = JSON.stringify({
      mode,
      vocal: config.vocal ?? { enabled: false },
      tracks: queue.map((t) => ({ song_id: Number(t.song_id), title: t.title ?? '', url: t.url ?? '' })),
      models: config.models,
      code: config.code,
      // 只取开头这么长的一段：整曲分析对情绪判断几乎没有额外收益，成本却随时长线性涨
      clip_seconds: clampInt(config.clipSeconds, 0, 600, DEFAULTS.clipSeconds),
      cache: {
        dir: audioCacheDir(),
        version: config.version,
        max_bytes: clampInt(config.audioCacheMaxBytes, 0, 1024 * GIB, DEFAULTS.audioCacheMaxBytes),
        concurrency: clampInt(config.downloadConcurrency, 1, 8, DEFAULTS.downloadConcurrency)
      }
    })

    let child
    try {
      child = spawn(config.python, [config.script], {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })
    } catch (error) {
      resolve({ results: {}, stopReason: 'fatal', error: `启动分析进程失败：${error.message}`, batches: 1 })
      return
    }
    // 子进程提前退出时写 stdin 会 EPIPE；结论由 close 事件给出
    child.stdin.on('error', () => {})

    const results = {}
    const dbWrites = []
    const noise = []
    let stdoutAll = ''
    let buffer = ''
    let stderr = ''
    let settled = false
    let stopReason = ''
    let timedOutSong = null
    let fatalError = ''
    let sawDone = false
    let stopRequested = false
    let storeFailed = 0
    let timerSong = null
    let timerBudget = null
    let timerFallback = null
    let timerGrace = null

    const clearTimers = () => {
      clearTimeout(timerSong)
      clearTimeout(timerBudget)
      clearTimeout(timerFallback)
      clearTimeout(timerGrace)
    }

    const currentSong = () => queue.find((t) => results[String(t.song_id)] === undefined)

    const finalize = (extra = {}) => {
      if (settled) return
      settled = true
      clearTimers()
      Promise.allSettled(dbWrites).then(() => {
        resolve({
          results,
          stopReason: extra.stopReason ?? stopReason,
          timedOutSong,
          error: extra.error ?? fatalError ?? '',
          sawDone,
          storeFailed
        })
      })
    }

    const requestStop = () => {
      if (stopRequested || settled) return
      stopRequested = true
      clearTimeout(timerSong)
      clearTimeout(timerBudget)
      try { child.kill() } catch { /* 已经退出 */ }
      // 等 close 收尾；万一 close 不来，5 秒后先返回，不把调用卡死
      timerFallback = setTimeout(() => finalize(), 5000)
    }

    const armSongTimer = () => {
      clearTimeout(timerSong)
      const song = currentSong()
      if (!song || settled) return
      timerSong = setTimeout(() => {
        if (settled || stopRequested) return
        stopReason = 'timeout'
        timedOutSong = song
        requestStop()
      }, perSongTimeoutMs)
    }

    // 人声批次：只收 {song_id, vocal}，落库交给调用方（updateVocal）
    const acceptVocal = (songId, value) => {
      const key = String(songId)
      const raw = value ?? {}
      if (raw.error) {
        results[key] = { vocalError: String(raw.error).slice(0, 160), at: new Date().toISOString() }
      } else {
        results[key] = { vocal: finiteOrNull(raw.vocal), at: new Date().toISOString() }
      }
      armSongTimer()
    }

    const acceptResult = (songId, value) => {
      const key = String(songId)
      if (Object.prototype.hasOwnProperty.call(results, key)) return
      const raw = value ?? {}
      if (raw?.error) {
        results[key] = { error: String(raw.error).slice(0, 160), at: new Date().toISOString() }
      } else {
        const payload = {
          probs: raw.probs ?? null,
          va: raw.va ?? null,
          // null / '' 是「没测」，不是 0：music2emo 目前不输出 stability
          stability: finiteOrNull(raw.stability),
          // CLAP 人声概率；没开或探测失败时为空
          vocal: finiteOrNull(raw.vocal),
          engine: config.version,
          at: new Date().toISOString()
        }
        results[key] = payload
        // 逐首落库：这一行写完，进程再被杀也不影响它
        const persist = storeOk
          ? writeAnalysis(key, config.version, payload)
          : writeLegacyCache(key, config.version, payload)
        dbWrites.push(persist.then((ok) => {
          if (ok) return true
          // 库写失败也退回 JSON 缓存，至少下次不用重算
          storeFailed += 1
          return writeLegacyCache(key, config.version, payload)
        }).catch(() => {
          storeFailed += 1
          return false
        }))
      }
      armSongTimer()
    }

    const handleLine = (rawLine) => {
      if (settled) return
      const text = rawLine.trim()
      if (text === '') return
      const parsed = parseJsonLine(text)
      if (!parsed) {
        if (noise.length < 20) noise.push(text.slice(0, 200))
        return
      }
      if (parsed.done === true) {
        sawDone = true
        clearTimeout(timerSong)
        clearTimeout(timerBudget)
        // 正常路径马上 exit；万一不退，给个收尾兜底
        timerGrace = setTimeout(() => finalize({ stopReason: '' }), 5000)
        return
      }
      if (parsed.song_id !== undefined && parsed.result !== undefined) {
        acceptResult(parsed.song_id, parsed.result)
        return
      }
      // 人声批次的行：{song_id, vocal} 或 {song_id, error}
      if (parsed.song_id !== undefined && (parsed.vocal !== undefined || parsed.error !== undefined)) {
        acceptVocal(parsed.song_id, { vocal: parsed.vocal, error: parsed.error })
        return
      }
      if (parsed.error && parsed.song_id === undefined) {
        fatalError = String(parsed.error)
        stopReason = 'fatal'
        requestStop()
        return
      }
      if (noise.length < 20) noise.push(text.slice(0, 200))
    }

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8')
      stdoutAll += text
      if (stdoutAll.length > 20 * 1024 * 1024) stdoutAll = stdoutAll.slice(-10 * 1024 * 1024)
      buffer += text
      let index
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        handleLine(line)
      }
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
      if (stderr.length > 20000) stderr = stderr.slice(-20000)
    })

    child.on('error', (error) => {
      fatalError = `启动分析进程失败：${error.message}`
      stopReason = 'fatal'
      finalize({ stopReason: 'fatal' })
    })

    child.on('close', (code) => {
      clearTimeout(timerFallback)
      clearTimeout(timerGrace)
      if (buffer.trim() !== '') {
        handleLine(buffer)
        buffer = ''
      }
      if (settled) return
      if (stopRequested) { finalize(); return }
      if (sawDone) { finalize({ stopReason: '' }); return }
      if (fatalError) { finalize({ stopReason: 'fatal' }); return }

      // 老版契约兜底：整个 stdout 是一个 {"results": {...}} 或 {"error": "..."}
      const legacy = parseJsonLine(stdoutAll.trim())
      if (legacy?.results && typeof legacy.results === 'object') {
        for (const [key, value] of Object.entries(legacy.results)) acceptResult(key, value)
        sawDone = true
        finalize({ stopReason: '' })
        return
      }
      if (legacy?.error) {
        fatalError = String(legacy.error)
        finalize({ stopReason: 'fatal' })
        return
      }

      stopReason = 'crash'
      const reason = stderr.trim() ? `：${stderr.trim().slice(-300)}` : ''
      const noisy = noise.length > 0 ? `｜stdout: ${noise.slice(0, 3).join(' / ')}` : ''
      fatalError = `分析进程退出（code ${code}）且没有 done${reason}${noisy}`
      finalize({ stopReason: 'crash' })
    })

    try {
      child.stdin.end(job)
    } catch { /* close 事件会给出结论 */ }
    armSongTimer()
    if (Number.isFinite(budgetMs) && budgetMs > 0) {
      timerBudget = setTimeout(() => {
        if (settled || stopRequested) return
        stopReason = 'budget'
        requestStop()
      }, budgetMs)
    }
  })
}

/** 把一批歌跑完；单首超时会被跳过，剩下的歌重开一批继续。 */
async function runBatch(batch, {
  config, deadline, perSongTimeoutMs, storeOk, results,
  breaker = { consecutive: 0 }, breakerLimit = DEFAULTS.breakerLimit
}) {
  const queue = batch.slice()
  const stats = { analyzed: 0, failed: 0, batches: 0, timeouts: 0, storeFailed: 0, consecutiveFailed: 0, stopReason: '', error: '' }

  while (queue.length > 0) {
    const budgetMs = deadline - Date.now()
    if (budgetMs <= 0) { stats.stopReason = stats.stopReason || 'budget'; break }

    const outcome = await runChild(queue, { config, budgetMs, perSongTimeoutMs, storeOk })
    stats.batches += 1
    stats.storeFailed += outcome.storeFailed ?? 0

    for (const [key, value] of Object.entries(outcome.results)) {
      if (Object.prototype.hasOwnProperty.call(results, key)) continue
      results[key] = value
      if (value?.error) {
        stats.failed += 1
        // 连败计数器跨批次累加：音源抖动时不该每批重新从 0 数起
        breaker.consecutive = (breaker.consecutive ?? 0) + 1
      } else {
        stats.analyzed += 1
        breaker.consecutive = 0
      }
    }
    stats.consecutiveFailed = breaker.consecutive ?? 0
    for (let i = queue.length - 1; i >= 0; i -= 1) {
      if (Object.prototype.hasOwnProperty.call(results, String(queue[i].song_id))) queue.splice(i, 1)
    }

    // 连续这么多首失败，基本是音源/网络侧出问题了，再空转只会烧时间
    if ((breaker.consecutive ?? 0) >= breakerLimit) {
      stats.stopReason = 'breaker'
      stats.error = `连续 ${breaker.consecutive} 首拿不到音频，已熔断本次调用（稍后可重试，失败曲目会进冷却）`
      break
    }
    if (outcome.stopReason === 'budget') {
      stats.stopReason = 'budget'
      break
    }
    if (outcome.stopReason === 'fatal') {
      stats.stopReason = 'fatal'
      stats.error = outcome.error ?? ''
      break
    }
    if (outcome.stopReason === 'crash') {
      stats.stopReason = 'crash'
      stats.error = outcome.error ?? ''
      break
    }
    if (outcome.timedOutSong) {
      stats.timeouts += 1
      const key = String(outcome.timedOutSong.song_id)
      if (!Object.prototype.hasOwnProperty.call(results, key)) {
        results[key] = {
          error: `分析超时（${Math.round(perSongTimeoutMs / 1000)}s）`,
          at: new Date().toISOString()
        }
        stats.failed += 1
      }
      const index = queue.findIndex((t) => String(t.song_id) === key)
      if (index >= 0) queue.splice(index, 1)
      continue
    }
    if (queue.length > 0) {
      // 子进程说 done 了却还有歌没结果：别丢，留给下一次
      stats.stopReason = outcome.sawDone ? 'incomplete' : 'crash'
      if (!stats.error) stats.error = outcome.error ?? ''
      break
    }
  }
  return stats
}

/**
 * 给「已经分析过情绪、但还没有人声概率」的歌补一轮 CLAP。
 * 只跑 CLAP，不重复 music2emo；结果由调用方写回 analysis.db 的 vocal 列。
 */
async function runVocalPass(tracks, { config, deadline }) {
  const out = {}
  if (tracks.length === 0) return out
  const cookie = await readCookie()
  const withUrls = await resolveUrls(tracks, cookie)
  const perSongTimeoutMs = clampInt(config.perSongTimeoutMs, 1000, 3600000, DEFAULTS.perSongTimeoutMs)
  for (let i = 0; i < withUrls.length; i += 8) {
    if (Date.now() >= deadline) break
    const batch = withUrls.slice(i, i + 8)
    const run = await runChild(batch, {
      config,
      budgetMs: deriveBudgetMs(batch.length, config),
      perSongTimeoutMs,
      storeOk: false,
      mode: 'vocal'
    })
    for (const [key, value] of Object.entries(run.results ?? {})) out[key] = value
    if (run.stopReason === 'fatal' || run.stopReason === 'crash') break
  }
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
  const storeOk = await analysisDbAvailable()
  const store = storeOk ? 'sqlite' : 'json'
  if (tracks.length === 0) {
    return {
      ok: true, results: {}, cached: 0, analyzed: 0, failed: 0, migrated: 0,
      partial: false, remaining: 0, stopReason: '', batches: 0, store, storeFailed: 0
    }
  }

  const startedAt = Date.now()
  const results = {}
  const pending = []
  const cooling = []
  let cached = 0
  let migrated = 0
  for (const track of tracks) {
    const key = String(track.song_id)
    if (options.force) {
      pending.push(track)
      continue
    }
    // 主缓存：SQLite。所有会话、所有曲目表共用同一个库。
    const hit = await readAnalysis(track.song_id, config.version)
    if (hit?.probs) {
      results[key] = hit
      cached += 1
      continue
    }
    // 一次性迁移：旧版 JSON 缓存读出来写进库，然后照常复用。
    const legacy = await readLegacyCache(track.song_id, config.version)
    if (legacy && !legacy.error) {
      await writeAnalysis(track.song_id, config.version, legacy)
      results[key] = legacy
      cached += 1
      migrated += 1
      continue
    }
    // 失败负缓存：冷却期内的歌直接跳过，不再为它等一次超时
    const failure = await readFailure(track.song_id, config.version)
    const retryAt = Date.parse(failure?.retryAfter ?? '')
    if (Number.isFinite(retryAt) && retryAt > Date.now()) {
      cooling.push(track.song_id)
      continue
    }
    pending.push(track)
  }
  const budgetMs = deriveBudgetMs(tracks.length, config)
  const deadline = startedAt + budgetMs
  const perSongTimeoutMs = clampInt(config.perSongTimeoutMs, 1000, 3600000, DEFAULTS.perSongTimeoutMs)
  const batchSize = clampInt(config.batchSize, 1, 32, DEFAULTS.batchSize)
  const vocalEnabled = config.vocal?.enabled !== false

  /** 给「已有情绪、缺人声」的歌补一轮 CLAP；返回补了多少首。 */
  const fillVocal = async () => {
    if (!vocalEnabled || Date.now() >= deadline) return 0
    const needVocal = tracks.filter((t) => {
      const hit = results[String(t.song_id)]
      return hit?.probs && hit.vocal == null
    })
    if (needVocal.length === 0) return 0
    const vocalResults = await runVocalPass(needVocal, { config, deadline })
    let filled = 0
    for (const [key, value] of Object.entries(vocalResults)) {
      if (!Number.isFinite(value?.vocal)) continue
      results[key] = { ...(results[key] ?? {}), vocal: value.vocal }
      if (storeOk) await updateVocal(key, config.version, value.vocal)
      filled += 1
    }
    return filled
  }

  if (pending.length === 0) {
    const vocalFilled = await fillVocal()
    return {
      ok: true, results, cached, analyzed: 0, failed: 0, migrated,
      partial: false, remaining: 0, stopReason: '', batches: 0, store, storeFailed: 0, vocalFilled,
      skippedCooldown: cooling.length, retryLater: cooling.length, triedIds: []
    }
  }

  const health = await engineHealth()
  if (!health.ok) {
    return { ok: false, error: 'music2emo 环境不完整', checks: health.checks, hint: '按 docs/DESIGN-v4.md §7.2 安装，或改 settings.json 的 analysis 段' }
  }

  const cookie = await readCookie()
  const withUrls = await resolveUrls(pending, cookie)

  const totals = { analyzed: 0, failed: 0, batches: 0, timeouts: 0, storeFailed: 0, error: '' }
  const breaker = { consecutive: 0 }
  const breakerLimit = clampInt(config.breakerLimit, 2, 64, DEFAULTS.breakerLimit)
  let stopReason = ''
  for (let i = 0; i < withUrls.length; i += batchSize) {
    if (Date.now() >= deadline) {
      stopReason = stopReason || 'budget'
      break
    }
    const batch = withUrls.slice(i, i + batchSize)
    const run = await runBatch(batch, { config, deadline, perSongTimeoutMs, storeOk, results, breaker, breakerLimit })
    totals.analyzed += run.analyzed
    totals.failed += run.failed
    totals.batches += run.batches
    totals.timeouts += run.timeouts
    totals.storeFailed += run.storeFailed
    if (run.stopReason) {
      stopReason = run.stopReason
      if (run.error) totals.error = run.error
      break
    }
    // 连败跨批次累计到上限就停，别把后面几十首也一个个等到超时
    if ((breaker.consecutive ?? 0) >= breakerLimit) {
      stopReason = 'breaker'
      totals.error = `连续 ${breaker.consecutive} 首拿不到音频，已熔断本次调用`
      break
    }
  }

  // 失败进负缓存（两次后冷却 10 分钟），成功的清掉旧记录
  for (const track of pending) {
    const value = results[String(track.song_id)]
    if (!value) continue
    if (value.error) await recordFailure(track.song_id, config.version, value.error)
    else await clearFailure(track.song_id, config.version)
  }

  // 人声回填：情绪已有结果、但 vocal 还是空的歌，补一轮 CLAP（不重算情绪）
  const vocalFilled = await fillVocal()

  const coolingSet = new Set(cooling)
  // remaining 只算「还没尝试过」的歌。失败的已经进了冷却，单独报 retryLater，
  // 否则同一个数字会随着失败/重试来回跳（2026-11-19 实测 11 → 17）。
  const remaining = tracks.filter((t) => {
    if (coolingSet.has(t.song_id)) return false
    return !Object.prototype.hasOwnProperty.call(results, String(t.song_id))
  }).length
  const failedNow = pending.filter((t) => results[String(t.song_id)]?.error).length
  if (remaining > 0) {
    if (!stopReason) stopReason = 'incomplete'
  } else if (!stopReason && (totals.timeouts > 0 || failedNow > 0)) {
    stopReason = 'timeout'
  }

  // 一首都没拿到、进程直接报错：按失败返回，让 bgm_tag 走环境检查提示
  if (Object.keys(results).length === 0 && (stopReason === 'fatal' || stopReason === 'crash')) {
    return {
      ok: false,
      error: totals.error || '分析进程没有返回任何结果',
      hint: '检查 E:\\Software\\audioml-m2e；首次分析会加载 MERT'
    }
  }

  return {
    ok: true,
    results,
    cached,
    analyzed: totals.analyzed,
    failed: totals.failed,
    migrated,
    partial: remaining > 0,
    remaining,
    stopReason,
    batches: totals.batches,
    store,
    storeFailed: totals.storeFailed,
    vocalFilled,
    skippedCooldown: cooling.length,
    retryLater: failedNow + cooling.length,
    triedIds: pending.map((t) => t.song_id),
    error: totals.error
  }
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
        // CLAP 零样本的「有人在唱」概率；没开人声识别或探测失败时是 null
        vocal: finiteOrNull(hit.vocal),
        stability: hit.stability ?? null,
        engine: hit.engine ?? '',
        at: hit.at ?? new Date().toISOString()
      }
      written += 1
    }
  }
  return written
}



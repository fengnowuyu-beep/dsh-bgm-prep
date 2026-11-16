// 自动打标：调本地 CLAP 环境，给候选曲加「情绪标签 + 人声概率」。
//
// 分工：Node 这边负责用完整 cookie 换**能播的直链**（weapi），Python 只负责下载 + 推理。
// 这样 Python 不用实现网易云的签名，也就不会因为只带 MUSIC_U 而拿到降级链。

import { spawn } from 'node:child_process'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ncm from './ncm.js'
import { readCookie } from './cookie.js'
import { songUrl } from './netease.js'

export { readCookie }

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_SCRIPT = path.join(HERE, '..', 'tools', 'tag', 'analyze.py')

const DEFAULTS = {
  python: 'E:\\Software\\Python310\\python.exe',
  sitePackages: 'E:\\Software\\audioml\\.venv\\Lib\\site-packages',
  hfHome: 'E:\\Software\\audioml\\models',
  script: DEFAULT_SCRIPT,
  proxy: '',
  timeoutMs: 600000
}

export async function taggerConfig() {
  let saved = {}
  try {
    const raw = JSON.parse(await fsp.readFile(path.join(ncm.dataDir(), 'settings.json'), 'utf8'))
    saved = raw?.tagger ?? {}
  } catch { /* 没配置就用默认 */ }
  return { ...DEFAULTS, ...saved, script: saved.script ?? DEFAULT_SCRIPT }
}

export async function taggerHealth() {
  const config = await taggerConfig()
  const exists = async (p) => fsp.stat(p).then(() => true, () => false)
  const checks = [
    { name: 'python', ok: await exists(config.python), path: config.python },
    { name: 'site-packages', ok: await exists(config.sitePackages), path: config.sitePackages },
    { name: 'analyze.py', ok: await exists(config.script), path: config.script },
    { name: '模型缓存', ok: await exists(config.hfHome), path: config.hfHome }
  ]
  return { ok: checks.every((c) => c.ok), checks }
}

/** 并发地把 id 换成播放直链；换不到的留空，让 Python 走自己的兜底。 */
async function resolveUrls(tracks, cookie, concurrency = 4) {
  const out = tracks.map((t) => ({
    song_id: Number(t.song_id),
    title: t.title ?? '',
    url: '',
    prompts: Array.isArray(t.prompts) ? t.prompts : []
  }))
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, out.length) }, async () => {
    while (cursor < out.length) {
      const index = cursor++
      const item = out[index]
      try {
        const resolved = await songUrl(item.song_id, cookie)
        item.url = resolved.url
      } catch { /* 换不到就留空 */ }
    }
  })
  await Promise.all(workers)
  return out
}

/**
 * 对一批曲目跑打标。
 * @param {{song_id:number,title?:string}[]} tracks
 * @param {{cookie?:string}} options
 */
export async function runTagger(tracks, options = {}) {
  const config = await taggerConfig()
  if (tracks.length === 0) return { ok: true, results: {} }
  const cookie = options.cookie ?? await readCookie()
  const withUrls = await resolveUrls(tracks, cookie)
  const job = JSON.stringify({ tracks: withUrls, cookie })
  const env = {
    ...process.env,
    PYTHONPATH: config.sitePackages,
    HF_HOME: config.hfHome,
    PYTHONIOENCODING: 'utf-8',
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost'
  }
  if (config.proxy) {
    env.HTTPS_PROXY = config.proxy
    env.HTTP_PROXY = config.proxy
  }

  return await new Promise((resolve) => {
    const child = spawn(config.python, [config.script], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
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
      finish({ ok: false, error: `打标超时（${Math.round(config.timeoutMs / 1000)}s）` })
    }, config.timeoutMs)

    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => finish({ ok: false, error: `启动打标进程失败：${error.message}（检查 settings.json 里的 tagger.python）` }))
    child.on('close', (code) => {
      if (settled) return
      const text = stdout.trim()
      if (text === '') {
        finish({ ok: false, error: `打标进程退出（code ${code}）且没有输出：${stderr.trim().slice(0, 300)}` })
        return
      }
      try {
        const parsed = JSON.parse(text.slice(text.indexOf('{')))
        if (parsed.error) finish({ ok: false, error: parsed.error })
        else finish({ ok: true, results: parsed.results ?? {} })
      } catch (error) {
        finish({ ok: false, error: `打标输出无法解析：${error.message}｜${stderr.trim().slice(0, 200)}` })
      }
    })
    try {
      child.stdin.end(job)
    } catch { /* close 事件会给出结论 */ }
  })
}

/** 把结果写回 cue.candidates[].auto。返回写入条数。 */
export function applyResults(cues, results) {
  let written = 0
  for (const cue of cues) {
    for (const candidate of cue.candidates ?? []) {
      const hit = results[String(candidate.song_id)]
      if (!hit) continue
      if (hit.error) {
        candidate.auto = { error: String(hit.error).slice(0, 60) }
        written += 1
        continue
      }
      candidate.auto = {
        top: Array.isArray(hit.top) ? hit.top.slice(0, 3) : [],
        match: Number(hit.match ?? 0),
        matchLabel: String(hit.matchLabel ?? ''),
        vocal: Number(hit.vocal ?? 0),
        margin: Number(hit.margin ?? 0),
        at: new Date().toISOString()
      }
      written += 1
    }
  }
  return written
}


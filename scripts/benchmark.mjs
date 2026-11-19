#!/usr/bin/env node
// 听感分析基准：一首歌 × 3 种音质 × 4 种取样方案 → 一份可交互 HTML。
//
// 之所以固化成脚本：2026-11-19 一天里默认值改了 4 次（无损→128k→320k→整曲→120s），
// 每次都得重写一遍临时脚本、重测一遍。以后再动默认值，跑这条命令就够。
//
// 用法：
//   node scripts/benchmark.mjs --song-id 1303708
//   node scripts/benchmark.mjs --sheet "F:/.../s2-migobase.cues.json" --cue s2
//   可选：--out <html 路径>  --python <music2emo 的 python>  --keep-json
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
// 相对 import 会按本文件所在目录解析，别用绝对路径（Windows 上 ESM 只认 file:// URL）
const { songUrl } = await import('../lib/netease.js')

const DEFAULTS = {
  python: 'E:\\Software\\audioml-m2e\\Scripts\\python.exe',
  code: 'E:\\Software\\audioml-m2e\\music2emo',
  models: 'E:\\Software\\audioml-m2e\\models',
  hfHome: 'E:\\Software\\audioml\\models'
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    if (!key.startsWith('--')) continue
    const name = key.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) { out[name] = true; continue }
    out[name] = next
    i += 1
  }
  return out
}

function readCookie() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(process.env.USERPROFILE || '', '.dsh', 'bgm-prep', 'settings.json'), 'utf8'))
    return raw.musicCookie || ''
  } catch {
    return ''
  }
}

const args = parseArgs(process.argv.slice(2))
const cookie = readCookie()
if (!cookie) {
  console.error('❌ 找不到网易云 cookie：先跑 node scripts/setup.mjs --login')
  process.exit(1)
}

// ---- 解析被测曲目 ----
let song = null
let cueInfo = null
if (args.sheet) {
  const sheetPath = path.resolve(args.sheet)
  const sheet = JSON.parse(await fsp.readFile(sheetPath, 'utf8'))
  const cue = args.cue
    ? sheet.cues.find((c) => c.id === args.cue)
    : sheet.cues.find((c) => (c.candidates ?? []).length > 0)
  if (!cue) {
    console.error(`❌ 找不到段 ${args.cue ?? '(任意有候选的段)'}`)
    process.exit(1)
  }
  const candidate = (cue.candidates ?? [])[0]
  if (!candidate) {
    console.error('❌ 这一段还没有候选')
    process.exit(1)
  }
  song = { id: candidate.song_id, title: candidate.title, duration: candidate.duration ?? 0 }
  cueInfo = { id: cue.id, scene: cue.scene, target: cue.target }
} else if (args['song-id']) {
  song = { id: Number(args['song-id']), title: String(args.title ?? `song ${args['song-id']}`), duration: 0 }
  cueInfo = {
    id: 'adhoc',
    scene: '自定义',
    target: [{ tag: 'dark', weight: 0.4 }, { tag: 'dramatic', weight: 0.3 }, { tag: 'heavy', weight: 0.3 }]
  }
} else {
  console.error('用法：node scripts/benchmark.mjs --song-id 1303708  或  --sheet <cues.json> [--cue s2]')
  process.exit(1)
}
if (!song.duration) song.duration = 240

console.log(`被测曲目：${song.title}（song_id ${song.id}）`)
console.log('解析三种音质的直链…')
const urls = {}
for (const quality of ['standard', 'high', 'lossless']) {
  const info = await songUrl(song.id, cookie, quality).catch((error) => ({ url: '', error }))
  urls[quality] = info.url ?? ''
  console.log(`  ${quality.padEnd(9)} ${urls[quality] ? 'ok' : '拿不到'}`)
}
if (!urls.lossless && !urls.high) {
  console.error('❌ 三种音质都拿不到直链，先确认登录状态')
  process.exit(1)
}

// ---- 跑测量 ----
const stamp = new Date().toISOString().slice(0, 10)
const tmpJob = path.join(ROOT, `.tmp-benchmark-job-${Date.now()}.json`)
const tmpOut = tmpJob.replace('-job-', '-out-')
const job = {
  song: { ...song, durationText: `${Math.floor(song.duration / 60)}:${String(song.duration % 60).padStart(2, '0')}` },
  cue: cueInfo,
  urls,
  code: args.code || DEFAULTS.code,
  models: args.models || DEFAULTS.models,
  hfHome: args.hfHome || DEFAULTS.hfHome
}
await fsp.writeFile(tmpJob, JSON.stringify(job, null, 2), 'utf8')

const python = args.python || DEFAULTS.python
console.log(`\n开始测量（每首四次推理：整首 / 120s / 60s / 三点）…\n`)
const code = await new Promise((resolve) => {
  const child = spawn(python, [path.join(ROOT, 'tools', 'm2e', 'benchmark.py'), '--job', tmpJob, '--out', tmpOut], {
    stdio: 'inherit',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
  })
  child.on('close', resolve)
  child.on('error', (error) => {
    console.error('❌ 启动测量脚本失败：', error.message)
    resolve(1)
  })
})
if (code !== 0) {
  await fsp.rm(tmpJob, { force: true })
  process.exit(code === 0 ? 1 : code)
}

// ---- 渲染 HTML ----
const result = JSON.parse(await fsp.readFile(tmpOut, 'utf8'))
delete result.createdAt
for (const row of result.rows) delete row.probs      // 56 维原向量不进报告
const template = await fsp.readFile(path.join(ROOT, 'tools', 'm2e', 'benchmark-report.html'), 'utf8')
const html = template.replace('/*__DATA__*/null', JSON.stringify(result))
const outFile = args.out
  ? path.resolve(args.out)
  : path.join(ROOT, 'docs', `benchmark-${stamp}-${song.title.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40)}.html`)
await fsp.mkdir(path.dirname(outFile), { recursive: true })
await fsp.writeFile(outFile, html, 'utf8')

await fsp.rm(tmpJob, { force: true })
if (!args['keep-json']) await fsp.rm(tmpOut, { force: true })
else console.log(`明细 JSON：${tmpOut}`)

console.log(`\n✅ 报告：${outFile}`)

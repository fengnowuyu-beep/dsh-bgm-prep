#!/usr/bin/env node
// 3 场景配乐测试的计时报告。
//
// 计时来源：
//   1) 工具调用耗时 = DSH 会话事件日志里 tool/call.time → tool/result.time。
//      不往会话里插额外调用，所以不会把计时自己算进去。
//   2) 逐首歌的标注耗时 = cues.json 里每个候选的 analysis.at 差值。
//      music2emo 的顺序推理决定了 at 就是「这一首算完的时刻」。
//
// 用法：
//   node timing.mjs --file <cues.json>
//   node timing.mjs --file <cues.json> --log <session.v4.jsonl.zstd>
//   node timing.mjs --file <cues.json> --json
//
// 产物：与 cues.json 同目录的 timing.md + timing.json；stdout 默认打印 Markdown。
// 退出码：0 正常；2 找不到会话日志或不再本表调用；1 其他错误。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

// 段内得分直接用插件的口径（含负向标签乘性惩罚、按实际数量归一化），
// 别再在这里维护第二份评分逻辑——2026-11-18 就是因为两份不同步，
// 报告里的「得分」和工作台显示的分数对不上。
const { scoreCandidate: pluginScoreCandidate } = await import('../../../../lib/score.js')

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const DSH_TOOLS = new Set(['bgm_init', 'bgm_fetch', 'bgm_tag', 'bgm_view', 'bgm_pick', 'bgm_commit'])

function fail(message, code = 2) {
  process.stderr.write(`❌ ${message}\n`)
  process.exit(code)
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--file' || arg === '-f') out.file = argv[++i]
    else if (arg === '--log') out.log = argv[++i]
    else if (arg === '--out') out.out = argv[++i]
    else if (arg === '--json') out.json = true
    else if (arg === '--help' || arg === '-h') out.help = true
    else if (!arg.startsWith('-') && !out.file) out.file = arg
    else fail(`不认识的参数：${arg}`, 1)
  }
  return out
}

function usage() {
  process.stdout.write([
    '用法：node timing.mjs --file <cues.json> [--log <session.v4.jsonl.zstd>] [--out <dir>] [--json]',
    '',
    '不给 --log 时，用 $DSH_HOME 和 $DSH_SESSION_ID 自动找当前会话日志。',
    '产物：<out 或 cues.json 所在目录>/timing.md 与 timing.json。'
  ].join('\n') + '\n')
}

function findSessionLog(explicit) {
  if (explicit) {
    const abs = path.resolve(explicit)
    if (!fs.existsSync(abs)) fail(`会话日志不存在：${abs}`)
    return abs
  }
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const sid = process.env.DSH_SESSION_ID
  if (!sid) fail('没有 DSH_SESSION_ID。请在 DSH 的 pwsh 里运行，或用 --log 指定会话日志。')
  const root = path.join(home, 'sessions')
  if (!fs.existsSync(root)) fail(`找不到会话目录：${root}`)
  for (const workspaceDir of fs.readdirSync(root)) {
    const candidate = path.join(root, workspaceDir, sid, 'session.v4.jsonl.zstd')
    if (fs.existsSync(candidate)) return candidate
  }
  fail(`找不到当前会话日志：${root}\\*\\${sid}\\session.v4.jsonl.zstd`)
}

function decodeFrame(buffer) {
  try {
    return zlib.zstdDecompressSync(buffer).toString('utf8')
  } catch {
    return ''
  }
}

/** DSH 的会话日志是「一帧一段 JSONL」的 zstd 拼接，逐帧解，不等整文件。 */
function readEvents(logFile) {
  if (typeof zlib.zstdDecompressSync !== 'function') {
    fail(`当前 Node ${process.version} 不支持 zstd；需要 Node >= 22.15（本机 DSH 自带 Node 24）。`, 1)
  }
  const buffer = fs.readFileSync(logFile)
  const offsets = []
  for (let i = 0; i + ZSTD_MAGIC.length <= buffer.length; i += 1) {
    if (buffer[i] === ZSTD_MAGIC[0] && buffer[i + 1] === ZSTD_MAGIC[1]
      && buffer[i + 2] === ZSTD_MAGIC[2] && buffer[i + 3] === ZSTD_MAGIC[3]) {
      offsets.push(i)
    }
  }
  if (offsets.length === 0) fail(`会话日志不是 zstd 帧格式：${logFile}`, 1)
  offsets.push(buffer.length)
  const events = []
  for (let i = 0; i < offsets.length - 1; i += 1) {
    const text = decodeFrame(buffer.subarray(offsets[i], offsets[i + 1]))
    if (!text) continue
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try { events.push(JSON.parse(line)) } catch { /* 忽略解析不了的行 */ }
    }
  }
  return events
}

function normalizePath(value) {
  return path.normalize(path.resolve(String(value))).toLowerCase()
}

function textOf(resultEvent) {
  const content = resultEvent?.data?.message?.content
  if (!Array.isArray(content)) return ''
  return content.map((item) => (typeof item?.text === 'string' ? item.text : '')).join('\n')
}

function collectCalls(events, targetFile) {
  const resultByCallId = new Map()
  for (const event of events) {
    if (event.type !== 'tool/result') continue
    const callId = event.data?.message?.toolCallId ?? event.data?.toolCallId
    if (callId) resultByCallId.set(callId, event)
  }

  const target = normalizePath(targetFile)
  const calls = []
  for (const event of events) {
    if (event.type !== 'tool/call') continue
    const name = String(event.data?.name ?? '')
    if (!DSH_TOOLS.has(name)) continue
    let args = {}
    try { args = JSON.parse(event.data?.arguments ?? '{}') } catch { continue }
    if (typeof args.file !== 'string' || normalizePath(args.file) !== target) continue
    const result = resultByCallId.get(event.data?.callId)
    calls.push({
      name,
      args,
      seq: event.seq,
      time: event.time,
      callId: event.data?.callId,
      resultTime: Number.isFinite(result?.time) ? result.time : null,
      duration: Number.isFinite(result?.time) ? Math.max(0, result.time - event.time) : null,
      isError: result?.data?.message?.isError === true,
      resultText: result ? textOf(result) : '',
      hasResult: Boolean(result)
    })
  }
  return calls.sort((a, b) => a.time - b.time)
}

function fmtMs(ms) {
  if (!Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  let rest = Math.round(seconds % 60)
  if (rest === 60) return `${minutes + 1}m00s`
  return `${minutes}m${String(rest).padStart(2, '0')}s`
}

function fmtLocal(ms) {
  return new Date(ms).toLocaleTimeString('zh-CN', { hour12: false })
}

function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim()
}

function stepLabel(call) {
  const ids = Array.isArray(call.args.cue_ids) ? call.args.cue_ids.join('、') : ''
  switch (call.name) {
    case 'bgm_init': return '建表'
    case 'bgm_fetch': return ids ? `检索 ${ids}` : '检索（全部段）'
    case 'bgm_tag': return ids ? `标注 ${ids}` : '标注（全部段）'
    case 'bgm_view': return '复核'
    case 'bgm_pick': return '定选'
    case 'bgm_commit': return '建歌单'
    default: return call.name
  }
}

function stepSummary(call) {
  if (call.name === 'bgm_init') return `${Array.isArray(call.args.cues) ? call.args.cues.length : '?'} 段`
  if (call.name === 'bgm_fetch') {
    const match = call.resultText.match(/已取候选：(\d+) 段/)
    return match ? `${match[1]} 段有候选` : ''
  }
  if (call.name === 'bgm_tag') {
    const analyzed = call.resultText.match(/已分析 (\d+) 首/)
    const cached = call.resultText.match(/缓存命中 (\d+)/)
    const failed = call.resultText.match(/其中 (\d+) 首失败/)
    const remaining = call.resultText.match(/还剩 (\d+) 首/)
    return [
      analyzed ? `新算 ${analyzed[1]} 首` : '',
      cached && cached[1] !== '0' ? `缓存 ${cached[1]}` : '',
      failed ? `失败 ${failed[1]}` : '',
      remaining ? `剩 ${remaining[1]}` : ''
    ].filter(Boolean).join('，')
  }
  if (call.name === 'bgm_view') return '只读'
  if (call.name === 'bgm_pick') return '不用于本测试'
  return ''
}

function scoreCandidate(cue, candidate) {
  const probs = candidate?.analysis?.probs
  if (!probs || typeof probs !== 'object') return null
  const out = pluginScoreCandidate(cue, candidate)
  return Number.isFinite(out?.score) ? out.score : null
}

/**
 * 把每个 bgm_tag 调用窗口里的 analysis.at 按时间排序，相邻差值 = 这一首的标注耗时。
 * 同一首歌在一次调用里只算一次（force 时不会重复，但共用 at 的复制候选要去重）。
 */
function buildTagTimeline(calls, sheet) {
  const entries = [] // { cueId, songId, at, callIndex, ms, first }
  const byCueSong = new Map()
  for (const call of calls.filter((c) => c.name === 'bgm_tag' && c.resultTime !== null)) {
    const windowStart = call.time - 2000
    const windowEnd = call.resultTime + 2000
    const bySong = new Map()
    for (const cue of sheet.cues) {
      const limited = Array.isArray(call.args.cue_ids) && call.args.cue_ids.length > 0
      if (limited && !call.args.cue_ids.includes(cue.id)) continue
      for (const candidate of cue.candidates ?? []) {
        const at = Date.parse(candidate.analysis?.at ?? '')
        if (!Number.isFinite(at) || at < windowStart || at > windowEnd) continue
        const key = String(candidate.song_id)
        const previous = bySong.get(key)
        if (!previous || previous.at < at) bySong.set(key, { songId: candidate.song_id, at })
      }
    }
    const timeline = [...bySong.values()].sort((a, b) => a.at - b.at)
    // 旧版（或任何一次性落库的版本）会把整批结果在同一毫秒里写完。
    // 这时相邻 at 差值没有意义，不能把整段耗时全算到第一首头上。
    const span = timeline.length > 1 ? timeline[timeline.length - 1].at - timeline[0].at : 0
    const burst = timeline.length > 1 && span < 1000 && (call.resultTime - call.time) > 5000
    let previousAt = call.time
    timeline.forEach((item, index) => {
      const ms = burst ? null : Math.max(0, item.at - previousAt)
      previousAt = item.at
      const record = {
        songId: item.songId,
        at: item.at,
        ms,
        burst,
        first: !burst && index === 0,
        callTime: call.time
      }
      entries.push(record)
      for (const cue of sheet.cues) {
        if (Array.isArray(call.args.cue_ids) && call.args.cue_ids.length > 0 && !call.args.cue_ids.includes(cue.id)) continue
        if (!(cue.candidates ?? []).some((candidate) => candidate.song_id === item.songId)) continue
        const key = `${cue.id}:${item.songId}`
        byCueSong.set(key, record)
      }
    })
  }
  return { entries, byCueSong }
}

function pickFetchCall(calls, cue) {
  const exact = calls.filter((call) => call.name === 'bgm_fetch'
    && Array.isArray(call.args.cue_ids) && call.args.cue_ids.includes(cue.id))
  const broad = calls.filter((call) => call.name === 'bgm_fetch'
    && !Array.isArray(call.args.cue_ids))
  const usable = [...exact, ...broad].filter((call) => call.resultTime !== null)
  return usable.sort((a, b) => b.time - a.time)[0] ?? null
}

function tagCallsForCue(calls, cue) {
  return calls.filter((call) => call.name === 'bgm_tag'
    && call.resultTime !== null
    && ((Array.isArray(call.args.cue_ids) && call.args.cue_ids.includes(cue.id))
      || !Array.isArray(call.args.cue_ids)))
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) { usage(); return }
  if (!args.file) { usage(); fail('缺少 --file <cues.json>', 1) }

  const sheetFile = path.resolve(args.file)
  if (!fs.existsSync(sheetFile)) fail(`曲目表不存在：${sheetFile}`)
  const sheet = JSON.parse(fs.readFileSync(sheetFile, 'utf8'))
  const logFile = findSessionLog(args.log)
  let allCalls = []
  let events = []
  // 日志是追加写的：最后几帧可能还没落盘。找不到调用/结果时等一拍再读，不靠人手动重试。
  for (let attempt = 0; attempt < 3; attempt += 1) {
    events = readEvents(logFile)
    allCalls = collectCalls(events, sheetFile)
    if (allCalls.length > 0 && allCalls.every((call) => call.hasResult)) break
    if (attempt < 2) await sleep(1200)
  }
  if (allCalls.length === 0) {
    fail([
      '会话日志里没有找到这份曲目表的 bgm_* 调用。',
      '检查：① --file 与工具参数里的路径是否同一份；② 会话日志是否刚落盘，等 2 秒再试；',
      `③ 日志文件：${logFile}`
    ].join('\n'))
  }

  const init = allCalls.find((call) => call.name === 'bgm_init')
  if (!init) fail('找到了调用，但没有 bgm_init；无法确定本次测试的起点。')
  const runCalls = allCalls.filter((call) => call.time >= init.time - 1000)
  const lastEnd = Math.max(...runCalls.map((call) => call.resultTime ?? call.time))
  const tagTimeline = buildTagTimeline(runCalls, sheet)

  const toolTotal = runCalls.reduce((sum, call) => sum + (call.duration ?? 0), 0)
  const wallTotal = Math.max(0, lastEnd - init.time)

  const cueSections = []
  const totals = {
    candidates: 0,
    uniqueSongs: new Set(),
    analyzedFresh: 0,
    cached: 0,
    failed: 0,
    missing: 0
  }

  sheet.cues.forEach((cue, index) => {
    const fetchCall = pickFetchCall(runCalls, cue)
    const fetchMs = fetchCall?.duration ?? null
    const broadFetch = fetchCall && !Array.isArray(fetchCall.args.cue_ids)
    const tagCalls = tagCallsForCue(runCalls, cue)
    const candidates = Array.isArray(cue.candidates) ? cue.candidates : []
    const lines = []
    lines.push(`### 第 ${index + 1} 段 · ${cue.scene}`)
    if (Array.isArray(cue.target) && cue.target.length > 0) {
      lines.push(`目标：${cue.target.map((item) => `${item.tag} ${Number(item.weight).toFixed(2)}`).join(' / ')}`)
    }
    if (fetchCall) {
      lines.push(`检索：${fmtMs(fetchMs)}（${broadFetch ? '全表一次检索，' : ''}${candidates.length} 首候选共用）`)
    } else {
      lines.push('检索：没有找到本段的 bgm_fetch 调用')
    }
    if (candidates.length === 0) {
      lines.push('', `> 本段没有候选${cue.note ? `：${cue.note}` : ''}`)
    } else {
      lines.push('', '| # | 歌曲 — 艺人 | 检索 | 标注 | 得分 | 备注 |',
        '|--:|---|---:|---:|---:|---|')
      candidates.forEach((candidate, candidateIndex) => {
        totals.candidates += 1
        const songId = String(candidate.song_id)
        totals.uniqueSongs.add(songId)
        const analysis = candidate.analysis ?? null
        const record = tagTimeline.byCueSong.get(`${cue.id}:${candidate.song_id}`)
        const at = Date.parse(analysis?.at ?? '')
        const fresh = record && Number.isFinite(at) && record.at === at
        let tagText = '—'
        let note = ''
        if (fresh) {
          tagText = record.ms === null ? '—' : fmtMs(record.ms)
          if (record.burst) note = '结果集中返回，未逐首拆分'
          else if (record.first) note = '批次首首（含模型加载）'
        } else if (analysis?.probs) {
          totals.cached += 1
          note = '缓存命中；本次未重算'
        } else if (analysis?.error) {
          if (record) {
            tagText = fmtMs(record.ms)
            totals.failed += 1
            note = `失败：${String(analysis.error).slice(0, 48)}`
          } else {
            totals.failed += 1
            note = `失败：${String(analysis.error).slice(0, 48)}`
          }
        } else {
          totals.missing += 1
          note = '未分析'
        }
        if (fresh && analysis?.probs) totals.analyzedFresh += 1
        const score = scoreCandidate(cue, candidate)
        const name = candidate.artist
          ? `${escapeCell(candidate.title)} — ${escapeCell(candidate.artist)}`
          : escapeCell(candidate.title)
        lines.push(`| ${candidateIndex + 1} | ${name} | ${fmtMs(fetchMs)} | ${tagText} | ${score === null ? '—' : score.toFixed(3)} | ${escapeCell(note)} |`)
      })
      const sceneTagCalls = tagCalls.map((call) => `${fmtMs(call.duration)}（${Array.isArray(call.args.cue_ids) ? call.args.cue_ids.join('、') : '全部段'}）`)
      if (sceneTagCalls.length > 0) lines.push('', `标注工具耗时：${sceneTagCalls.join('；')}`)
      if (candidates.some((candidate) => {
        const record = tagTimeline.byCueSong.get(`${cue.id}:${candidate.song_id}`)
        return record?.burst === true
      })) {
        lines.push('', '> 本段本次有结果集中返回，逐首耗时不可拆；先看上面的工具总耗时。')
      }
    }
    cueSections.push(lines.join('\n'))
  })

  const stepRows = runCalls.map((call) => {
    const summary = stepSummary(call)
    return `| ${stepLabel(call)} | \`${call.name}\` | ${call.duration === null ? '未返回' : fmtMs(call.duration)} | ${escapeCell(summary)} |`
  })

  const ready = totals.missing === 0 && totals.failed === 0
  const uniqueCount = totals.uniqueSongs.size
  const header = [
    '# 配乐 3 场景测试 · 计时报告',
    '',
    `- 曲目表：\`${sheetFile}\``,
    `- 会话日志：\`${logFile}\``,
    `- 本次：${sheet.cues.length} 段 / ${totals.candidates} 个候选（${uniqueCount} 首唯一曲）`,
    `- 标注：本次新算 ${totals.analyzedFresh} 个候选，缓存 ${totals.cached} 个，失败 ${totals.failed} 个，未分析 ${totals.missing} 个`,
    `- 墙钟：${fmtMs(wallTotal)}（从 bgm_init 调用开始，到最后一次工具返回；含对话轮转）`,
    `- 工具内耗时合计：${fmtMs(toolTotal)}`,
    '',
    '## 1. 步骤耗时（工具调用）',
    '',
    '| 步骤 | 工具 | 耗时 | 结果 |',
    '|---|---|---:|---|',
    ...stepRows,
    `| **合计** | — | **${fmtMs(toolTotal)}** | 墙钟 ${fmtMs(wallTotal)} |`,
    '',
    '## 2. 每首歌的每步耗时',
    '',
    ...cueSections,
    '',
    '## 3. 口径',
    '',
    '- 工具耗时来自 DSH 会话事件日志：`tool/call` 到对应 `tool/result`，是工具真实执行时间，不含前后对话轮转。',
    '- 单首「标注」耗时来自 `analysis.at` 的相邻差值：前一首算完 → 这一首算完。',
    '- **每个 `bgm_tag` 调用的第一首**会把模型加载、播放直链解析和首段下载算进去，所以明显偏大；这是真实等待时间，不是异常。',
    '- 「检索」耗时由同段候选共用：一次 `bgm_fetch` 搜索的是整段，无法再拆到单首。',
    '- 缓存命中的曲子本次没有重新推理，因此不给「本次标注耗时」；测试流程用 `force: true` 尽量避免这种情况。',
    '- 墙钟与工具合计的差值是模型/agent 在工具调用之间的思考与生成时间。',
    '- 「得分」与工作台同口径：正向加权分 × 负向标签惩罚（k=0.6）× 人声惩罚（CLAP，按 cue.vocal）；直接复用 `lib/score.js`，不再维护第二份评分。',
    '',
    ready
      ? '✅ 所有候选都有 analysis.probs；工作台里每行会显示「得分 + 两个概率最高的标签」。'
      : `⚠️ 有 ${totals.failed} 个候选分析失败、${totals.missing} 个未分析；工作台里这些行没有得分，报告里已逐首标出。`
  ].join('\n')

  const outDir = path.resolve(args.out ?? path.dirname(sheetFile))
  fs.mkdirSync(outDir, { recursive: true })
  const markdownFile = path.join(outDir, 'timing.md')
  const jsonFile = path.join(outDir, 'timing.json')
  const json = {
    file: sheetFile,
    log: logFile,
    generatedAt: new Date().toISOString(),
    totals: { ...totals, uniqueSongs: uniqueCount, toolMs: toolTotal, wallMs: wallTotal },
    steps: runCalls.map((call) => ({
      name: call.name,
      label: stepLabel(call),
      cueIds: call.args.cue_ids ?? null,
      start: new Date(call.time).toISOString(),
      durationMs: call.duration
    })),
    cues: sheet.cues.map((cue, index) => ({
      index: index + 1,
      id: cue.id,
      scene: cue.scene,
      fetchMs: pickFetchCall(runCalls, cue)?.duration ?? null,
      candidates: (cue.candidates ?? []).map((candidate) => {
        const record = tagTimeline.byCueSong.get(`${cue.id}:${candidate.song_id}`)
        const at = Date.parse(candidate.analysis?.at ?? '')
        const fresh = record && Number.isFinite(at) && record.at === at
        return {
          songId: candidate.song_id,
          title: candidate.title,
          artist: candidate.artist ?? '',
          tagMs: fresh ? record.ms : null,
          firstInBatch: fresh ? record.first : false,
          burst: fresh ? record.burst === true : false,
          cached: Boolean(candidate.analysis?.probs) && !fresh,
          error: candidate.analysis?.error ?? null,
          score: scoreCandidate(cue, candidate)
        }
      })
    }))
  }
  fs.writeFileSync(markdownFile, `${header}\n`, 'utf8')
  fs.writeFileSync(jsonFile, `${JSON.stringify(json, null, 2)}\n`, 'utf8')

  if (args.json) {
    process.stdout.write(`${JSON.stringify(json, null, 2)}\n`)
  } else {
    process.stdout.write(`${header}\n\n<!-- 已写入：${markdownFile} -->\n`)
  }
}

try {
  await main()
} catch (error) {
  fail(error?.stack ?? String(error), 1)
}


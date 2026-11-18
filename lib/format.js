// 表版式。两个版本：
//   L1 场景表 —— 只要了 BGM 还没选曲时看，核对"切得对不对"
//   L2 曲目表 —— 有选曲之后看，核对"选得对不对"
// 版式规则（硬）：表内只有一个编号「第 k 段」；不靠空格对齐；不用 <details> 折叠。

import { cueStatus } from './store.js'
import { topTags, VOCAL_DEFAULTS } from './score.js'
import { labelOf } from './tagLabels.js'
import { AVOID_K } from './target.js'

const VALENCE = { bright: '明', neutral: '中', dark: '暗' }
const ENERGY = { static: '静态', building: '渐强', driving: '推进', burst: '爆发' }
const VOCAL = { none: '无人声', wordless: '无词人声', lyrics: '有词' }

/** 0–1 的数值统一显示成整数百分比（无小数位）。 */
function pct(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return `${Math.round(n * 100)}%`
}

// 人声态度：给每段显示「这段在不在乎人声」，而不是只藏在 cue.vocal 字段里。
// 括号里的百分比 = 这一档最多能扣多少（penalty × 档位系数），与打分公式同口径。
// 注意：判定阈值 threshold（p 超过 0.25 才罚）是全局参数，不写在这里，避免把两者混为一谈。
const VOCAL_ATTITUDE = {
  none: { label: '不出现', scale: 1 },
  any: { label: '可接受', scale: 0.5 },
  wordless: { label: '歌声', scale: 0 }
}

export function vocalAttitudeLine(cue, penalty = VOCAL_DEFAULTS.penalty) {
  const entry = VOCAL_ATTITUDE[cue?.vocal ?? 'any']
  if (!entry) return ''
  if (entry.scale === 0) return `人声态度：${entry.label}（不扣）`
  const pct = Math.round(Number(penalty) * entry.scale * 100)
  const text = String(pct)
  return `人声态度：${entry.label}（最多 −${text}%）`
}

export function mmss(seconds) {
  if (!seconds || !Number.isFinite(seconds)) return ''
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** 目标标签行：`[黑暗 0.40 / 戏剧张力 0.30 / 平静 0.20]`（显示中文，数据仍是英文） */
export function targetLine(target) {
  if (!Array.isArray(target) || target.length === 0) return ''
  return `[${target.map((t) => `${labelOf(t.tag)} ${pct(t.weight)}`).join(' / ')}]`
}

/** 分析结果行：`黑暗 0.72 · 戏剧张力 0.58` */
export function analysisLine(analysis, n = 2) {
  const top = topTags(analysis, n)
  return top.map(([tag, p]) => `${labelOf(tag)} ${pct(p)}`).join(' · ')
}

/**
 * 负向标签行：`负向标签 [欢快 0.43 / 轻快 0.35]（上限 60%）`。
 * 「上限」= k × Σ权重——权重按实际数量归一化，所以通常正好是 60%。
 */
export function avoidLine(avoidTargets) {
  if (!Array.isArray(avoidTargets) || avoidTargets.length === 0) return ''
  const sum = avoidTargets.reduce((acc, t) => acc + (Number(t.weight) || 0), 0)
  const body = avoidTargets.map((t) => `${labelOf(t.tag)} ${pct(t.weight)}`).join(' / ')
  return `负向标签 [${body}]（上限 ${Math.round(AVOID_K * sum * 100)}%）`
}

export function tagLine(tags) {
  if (!tags) return ''
  const parts = []
  if (tags.valence) parts.push(VALENCE[tags.valence] ?? tags.valence)
  if (tags.energy) parts.push(ENERGY[tags.energy] ?? tags.energy)
  if (Array.isArray(tags.texture) && tags.texture.length > 0) parts.push(tags.texture.join('/'))
  if (tags.vocal) parts.push(VOCAL[tags.vocal] ?? tags.vocal)
  if (Number.isFinite(tags.tension)) parts.push(`张力${tags.tension}`)
  return parts.length > 0 ? `[${parts.join(' / ')}]` : ''
}

function header(sheet) {
  const stats = sheet.cues.reduce((acc, cue) => {
    acc.total += 1
    if (cue.need_bgm) acc.need += 1
    return acc
  }, { total: 0, need: 0 })
  const title = [sheet.module, sheet.session ? `第${sheet.session}回` : '', sheet.scope].filter(Boolean).join(' · ')
  return `${title}          共 ${stats.total} 段 / ${stats.need} 段需配乐`
}

/**
 * 一行候选：`01 曲名 — 艺人 · 3:24 · 得分 0.76 · 黑暗 72% / 沉重 55% · 歌单名`
 * 得分是分析后的段内得分（0–1）；还没分析时显示 `得分 —`，并把抓取期的关键词分单独标出来。
 */
export function candidateLine(track, index) {
  const name = track?.artist ? `${track.title} — ${track.artist}` : (track?.title ?? `song_id ${track?.song_id}`)
  const bits = [`${String(index + 1).padStart(2, '0')} ${name}`]
  if (track?.duration) bits.push(mmss(track.duration))
  const score = Number(track?.score)
  if (track?.analysis?.probs && Number.isFinite(score)) bits.push(`得分 ${score.toFixed(2)}`)
  else bits.push('得分 —')
  if (track?.analysis?.probs) {
    const tags = analysisLine(track.analysis, 2)
    if (tags) bits.push(tags)
  } else if (Number.isFinite(Number(track?.fetchScore))) {
    bits.push(`未分析（关键词分 ${Number(track.fetchScore)}）`)
  }
  if (track?.source) bits.push(`出自《${track.source}》`)
  return `        ${bits.join(' · ')}`
}

function cueBlock(sheet, cue, index, { mode, showTrigger, vocalPenalty, withCandidates, candidateLimit }) {
  const lines = []
  const no = `第 ${index + 1} 段`
  const tags = targetLine(cue.target) + (cue.need_bgm && cue.targetSource === 'none' ? '  [描述未命中标签]' : '')
  const status = cueStatus(cue)

  if (!cue.need_bgm) {
    lines.push(`${no}  ${cue.scene}${tags ? `    ${tags}` : ''}`)
    lines.push(`        —— 不配乐${cue.note ? `（${cue.note}）` : ''}`)
    return lines
  }

  lines.push(`${no}  ${cue.scene}${mode === 'full' && tags ? `    ${tags}` : ''}`)
  if (mode === 'cues' || showTrigger) {
    if (cue.trigger) lines.push(`        ${cue.trigger}`)
    if (mode === 'cues' && tags) lines.push(`        ${tags}`)
  }
  const avoid = avoidLine(cue.avoidTargets)
  if (avoid) lines.push(`        ${avoid}`)
  const attitude = vocalAttitudeLine(cue, vocalPenalty)
  if (attitude) lines.push(`        ${attitude}`)

  if (mode === 'full') {
    if (status === 'picked') {
      const primary = cue.picks.primary
      const track = cue.candidates.find((c) => c.song_id === primary.song_id)
      // 候选池被重抓后旧选曲会消失，这时用 pick 时存下的曲名快照
      const name = track
        ? (track.artist ? `${track.title} — ${track.artist}` : track.title)
        : (primary.title ? `${primary.title}${primary.artist ? ` — ${primary.artist}` : ''}` : `song_id ${primary.song_id}`)
      const dur = track && track.duration ? `   ${mmss(track.duration)}` : ''
      lines.push(`        01 ${name}${dur}`)
      if (primary.why) lines.push(`        ${primary.why}`)
      const altCount = Array.isArray(cue.picks.alts) ? cue.picks.alts.length : 0
      if (altCount > 0) lines.push(`        备选 ${altCount}`)
    } else if (status === 'insufficient') {
      lines.push('        —— 候选不足，可能不对味')
    } else {
      lines.push(`        —— 待选（候选 ${cue.candidates.length}）`)
      if (withCandidates && cue.candidates.length > 0) {
        const limit = Math.max(1, Number(candidateLimit) || 6)
        cue.candidates.slice(0, limit).forEach((c, i) => lines.push(candidateLine(c, i)))
        if (cue.candidates.length > limit) {
          lines.push(`        …还有 ${cue.candidates.length - limit} 首（candidate_limit 调大切到全量）`)
        }
      }
    }
  }
  return lines
}

/**
 * @param {object} sheet
 * @param {{mode?: 'cues'|'full', cueIds?: string[], showTrigger?: boolean, max?: number,
 *          withCandidates?: boolean, candidateLimit?: number}} options
 */
export function renderTable(sheet, options = {}) {
  const mode = options.mode ?? 'cues'
  const showTrigger = options.showTrigger ?? mode === 'cues'
  // full 模式默认把候选列出来：agent 判断「池子对不对」全靠这几行，
  // 以前只给一个「候选 8」的数字，只能回头去读 JSON。
  const withCandidates = options.withCandidates ?? mode === 'full'
  const candidateLimit = options.candidateLimit ?? 6
  const filter = Array.isArray(options.cueIds) && options.cueIds.length > 0
    ? new Set(options.cueIds)
    : null
  const out = [header(sheet), '']
  let shown = 0
  sheet.cues.forEach((cue, index) => {
    if (filter && !filter.has(cue.id)) return
    if (options.max && shown >= options.max) return
    out.push(...cueBlock(sheet, cue, index, {
      mode, showTrigger, withCandidates, candidateLimit, vocalPenalty: options.vocalPenalty
    }))
    out.push('')
    shown += 1
  })
  if (options.max && shown >= options.max && shown < sheet.cues.length) {
    out.push(`（只显示前 ${shown} 段，完整表用 bgm_view 不带 max）`)
  }
  return out.join('\n').trimEnd()
}

/** review.md 的完整正文。 */
export function renderReview(sheet, options = {}) {
  const stats = sheet.cues.reduce((acc, cue) => {
    acc.total += 1
    if (cue.need_bgm) acc.need += 1
    const s = cueStatus(cue)
    acc[s] = (acc[s] ?? 0) + 1
    return acc
  }, { total: 0, need: 0 })

  const out = [
    `# ${sheet.module || '(未命名模组)'}${sheet.session ? ` · 第${sheet.session}回` : ''}${sheet.scope ? ` · ${sheet.scope}` : ''}`,
    '',
    `共 ${stats.total} 段，其中 ${stats.need} 段配乐；已选 ${stats.picked ?? 0} 段，不配乐 ${stats.skipped ?? 0} 段。`,
    sheet.source ? `原文：${sheet.source}` : '',
    '',
    '## 曲目表',
    '',
    renderTable(sheet, { mode: 'full', vocalPenalty: options.vocalPenalty })
  ]
  return out.filter((line) => line !== null).join('\n').trimEnd() + '\n'
}

/**
 * 把多份表按给定顺序合成一份（跨 scope 出歌单/清单用）。
 * 段序 = 文件的先后顺序 + 文件内顺序，正好对上跑团时的换表顺序。
 */
export function mergeSheets(sheets) {
  const list = Array.isArray(sheets) ? sheets.filter(Boolean) : []
  const first = list[0] ?? { cues: [], module: '', scope: '', session: null }
  return {
    ...first,
    scope: list.map((s) => s.scope).filter(Boolean).join('+'),
    cues: list.flatMap((s) => s.cues ?? [])
  }
}

/** 跨 scope 的 review.md：每个 scope 一节，段号在各自表内重新从 1 开始。 */
export function renderCombinedReview(sheets, options = {}) {
  const list = Array.isArray(sheets) ? sheets.filter(Boolean) : []
  const first = list[0] ?? {}
  const total = list.reduce((n, s) => n + s.cues.length, 0)
  const picked = list.reduce((n, s) => n + s.cues.filter((c) => cueStatus(c) === 'picked').length, 0)
  const out = [
    `# ${first.module || '(未命名模组)'}${first.session ? ` · 第${first.session}回` : ''} · 合并表`,
    '',
    `共 ${list.length} 份表 / ${total} 段，已选 ${picked} 段。段序按文件顺序排列。`,
    ''
  ]
  list.forEach((sheet, i) => {
    out.push(`## ${i + 1}. ${sheet.scope || `第 ${i + 1} 份`}`, '')
    out.push(renderTable(sheet, { mode: 'full', vocalPenalty: options.vocalPenalty }), '')
  })
  return out.join('\n').trimEnd() + '\n'
}

/** 可粘贴清单：每行「曲名 - 艺人」，无编号无标签。 */
export function renderPlaylistText(sheet) {
  const lines = []
  for (const cue of sheet.cues) {
    if (cueStatus(cue) !== 'picked') continue
    const found = cue.candidates.find((c) => c.song_id === cue.picks.primary.song_id)
    const track = found ?? { title: cue.picks.primary.title, artist: cue.picks.primary.artist }
    if (!track?.title) continue
    lines.push(track.artist ? `${track.title} - ${track.artist}` : track.title)
  }
  return lines.join('\r\n') + '\r\n'
}

/** 带 song_id 的 CSV（UTF-8 BOM，Excel 直接开）。 */
export function renderPlaylistCsv(sheet) {
  const rows = [['段', 'song_id', '曲名', '艺人', '时长', '理由', '备选数']]
  sheet.cues.forEach((cue, index) => {
    if (cueStatus(cue) !== 'picked') return
    const primary = cue.picks.primary
    const track = cue.candidates.find((c) => c.song_id === primary.song_id)
    rows.push([
      String(index + 1),
      String(primary.song_id),
      track?.title ?? primary.title ?? '',
      track?.artist ?? primary.artist ?? '',
      track?.duration ? mmss(track.duration) : '',
      primary.why ?? '',
      String(Array.isArray(cue.picks.alts) ? cue.picks.alts.length : 0)
    ])
  })
  const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n')
  return `\ufeff${csv}\r\n`
}

/**
 * 给一首候选生成一句「为什么它在列表里」的说明。
 * 依据只有元数据（来源歌单 / 专辑 / 标题命中情绪词 / 时长），不编造听感。
 */
export function explainCandidate(track, cue) {
  const bits = []
  if (track?.source) bits.push(`出自《${track.source}》`)
  else if (track?.album) bits.push(`专辑《${track.album}》`)
  if (track?.duration) bits.push(mmss(track.duration))
  return bits.length > 0 ? bits.join(' · ') : '来自候选池'
}






// 段内打分：目标权重 × 模型概率，没有 softmax，没有二次映射。
//
// 分数只在同一段内可比——它的定义就是「按这段的权重算出来的」。

import { AVOID_K } from './target.js'

/** @param {object} analysis 候选的 analysis 字段 */
export function probabilities(analysis) {
  const probs = analysis?.probs
  return probs && typeof probs === 'object' ? probs : null
}

/**
 * 按目标权重算一段候选的得分。
 * 缺失的概率不按 0 算，而是从分母里扣掉，并通过 coverage 暴露出来。
 * @returns {{score: number, coverage: number, parts: {tag: string, weight: number, p: number}[]}}
 */
export function scoreTarget(target, analysis) {
  const items = Array.isArray(target) ? target : []
  const probs = probabilities(analysis)
  if (items.length === 0) return { score: 0, coverage: 0, parts: [] }
  if (!probs) return { score: 0, coverage: 0, parts: [] }

  let weighted = 0
  let usedWeight = 0
  let totalWeight = 0
  const parts = []
  for (const item of items) {
    const weight = Number(item?.weight)
    if (!Number.isFinite(weight) || weight <= 0) continue
    totalWeight += weight
    const p = Number(probs[item.tag])
    if (!Number.isFinite(p)) continue
    const clamped = Math.max(0, Math.min(1, p))
    weighted += weight * clamped
    usedWeight += weight
    parts.push({ tag: item.tag, weight, p: clamped })
  }
  if (usedWeight === 0) return { score: 0, coverage: 0, parts }
  const score = weighted / usedWeight
  const coverage = totalWeight > 0 ? usedWeight / totalWeight : 0
  return { score: Number(score.toFixed(3)), coverage: Number(coverage.toFixed(2)), parts }
}

/**
 * 负向标签的乘性惩罚：`factor = 1 − k · Σ w⁻·p`（k = AVOID_K = 0.6）。
 * 权重按实际数量归一化（和为 1），所以 factor ∈ [1−k, 1]，分数不会被压成负数。
 * 每个标签独立计分，不去重、不合并不做相关性处理（需求明确要求）。
 * @returns {{factor:number, parts:{tag:string,weight:number,p:number,impact:number}[]}}
 */
export function avoidFactor(cue, candidate) {
  const avoid = Array.isArray(cue?.avoidTargets) ? cue.avoidTargets : []
  const probs = probabilities(candidate?.analysis)
  if (avoid.length === 0 || !probs) return { factor: 1, parts: [] }
  let pressure = 0
  const parts = []
  for (const item of avoid) {
    const weight = Number(item?.weight)
    if (!Number.isFinite(weight) || weight <= 0) continue
    const raw = Number(probs[item.tag])
    const p = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0
    pressure += weight * p
    parts.push({ tag: item.tag, weight, p, impact: Number((AVOID_K * weight * p).toFixed(4)) })
  }
  const factor = Math.max(1 - AVOID_K, 1 - AVOID_K * pressure)
  return { factor: Number(factor.toFixed(4)), parts }
}

/** 人声惩罚的默认参数：阈值以下不罚，1.0 时按 penalty 全额乘。 */
export const VOCAL_DEFAULTS = { penalty: 0.6, threshold: 0.1 }

/**
 * 人声惩罚（乘性）：CLAP 给出「有人在唱」概率 p 后，
 * factor = 1 − penalty · cueScale · clamp((p − threshold)/(1 − threshold), 0, 1)。
 * - cue.vocal = none → 全额；any → 半额；wordless → 不罚（和声/吟唱可接受）。
 * - 没有 vocal 概率（没开识别/探测失败）→ 不罚。
 */
export function vocalFactor(cue, candidate, options = {}) {
  const want = cue?.vocal ?? 'any'
  const scale = want === 'none' ? 1 : want === 'any' ? 0.5 : 0
  if (scale <= 0) return 1
  const p = Number(candidate?.analysis?.vocal)
  if (!Number.isFinite(p)) return 1
  const penalty = Math.max(0, Math.min(0.6, Number(options?.vocalPenalty ?? VOCAL_DEFAULTS.penalty) || 0))
  const threshold = Math.max(0, Math.min(0.95, Number(options?.vocalThreshold ?? VOCAL_DEFAULTS.threshold) || 0))
  if (penalty <= 0) return 1
  const strength = Math.max(0, Math.min(1, (p - threshold) / (1 - threshold)))
  return Number((1 - penalty * scale * strength).toFixed(4))
}

/**
 * 完整打分：正向 base 分 × 负向标签惩罚 × 人声惩罚。
 * @param {{target: {tag:string,weight:number}[], avoidTargets?: {tag:string,weight:number}[], vocal?: string}} cue
 * @param {object} candidate
 * @param {{vocalPenalty?:number, vocalThreshold?:number}} options
 */
export function scoreCandidate(cue, candidate, options = {}) {
  const result = scoreTarget(cue?.target, candidate?.analysis)
  const avoid = avoidFactor(cue, candidate)
  const vocal = vocalFactor(cue, candidate, options)
  const score = Math.max(0, Number((result.score * avoid.factor * vocal).toFixed(3)))
  return { score, coverage: result.coverage, parts: result.parts, avoid, vocal }
}

/** 这段所有候选，按得分降序（稳定排序，同分保留原顺序）。 */
export function rankCandidates(cue, options = {}) {
  const list = Array.isArray(cue?.candidates) ? cue.candidates : []
  return list
    .map((candidate, index) => ({ candidate, index, ...scoreCandidate(cue, candidate, options) }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
}

/**
 * 已分析候选里最终得分 ≥ threshold 的条数。
 * 负向标签压得太狠（<3 首）时用它决定要不要明确提示，而不是悄悄放宽。
 */
export function effectiveCount(cue, threshold = 0.2, options = {}) {
  const scored = (cue?.candidates ?? []).filter((c) => c?.analysis?.probs)
  return rankCandidates({ ...cue, candidates: scored }, options).filter((r) => r.score >= threshold).length
}

/** 分析里概率最高的 n 个标签，用于「为什么排第一」。 */
export function topTags(analysis, n = 3) {
  const probs = probabilities(analysis)
  if (!probs) return []
  return Object.entries(probs)
    .filter(([, p]) => Number.isFinite(Number(p)))
    .map(([tag, p]) => [tag, Number(p)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
}

/** 档位：只用于 UI 上色，不参与排序。 */
export function matchLevel(score) {
  if (!Number.isFinite(score)) return 'unknown'
  if (score >= 0.5) return 'good'
  if (score >= 0.25) return 'fair'
  return 'poor'
}

/** 池子匹配度的下限：低于它说明「这池子里压根没有对味的歌」，与权重无关。 */
export const POOL_MATCH_MIN = 0.25

/**
 * 候选池与目标的匹配度（0–1）：每首取目标标签里最高的那个概率，再对所有已分析候选求平均。
 *
 * 为什么需要它：`effectiveCount` 低有两种完全不同的原因——
 *   1. 池子里有对味的歌，但负向标签把分数压扁了 → 该调权重；
 *   2. 池子里根本没有对味的歌（歌名撞了检索词，实则儿歌/流行）→ 该换检索词重抓。
 * 只看「过线几首」分不出这两种，会把人引向错误的修法（2026-11-19 实测踩过）。
 */
export function poolMatch(cue) {
  const scored = (Array.isArray(cue?.candidates) ? cue.candidates : []).filter((c) => c?.analysis?.probs)
  if (scored.length === 0) return null
  const tags = (Array.isArray(cue?.target) ? cue.target : []).map((t) => t?.tag).filter(Boolean)
  if (tags.length === 0) return null
  let sum = 0
  for (const candidate of scored) {
    let best = 0
    for (const tag of tags) {
      const p = Number(candidate.analysis.probs[tag])
      if (Number.isFinite(p)) best = Math.max(best, Math.max(0, Math.min(1, p)))
    }
    sum += best
  }
  return Number((sum / scored.length).toFixed(3))
}



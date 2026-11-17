// 段内打分：目标权重 × 模型概率，没有 softmax，没有二次映射。
//
// 分数只在同一段内可比——它的定义就是「按这段的权重算出来的」。

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
  let score = weighted / usedWeight
  const coverage = totalWeight > 0 ? usedWeight / totalWeight : 0

  // 人声否决：这段要无人声而候选大概率有人声 → 降一档（不剔除）
  const vocal = Number(analysis?.vocal)
  if (Number.isFinite(vocal) && vocal > 0.5) {
    // cue 的 vocal 偏好由调用方传入；没有就只记录不扣分
  }
  return { score: Number(score.toFixed(3)), coverage: Number(coverage.toFixed(2)), parts }
}

/**
 * 完整打分：target + 分析 + 段的人声偏好。
 * @param {{target: {tag:string,weight:number}[], vocal?: string}} cue
 * @param {object} candidate
 */
export function scoreCandidate(cue, candidate) {
  const result = scoreTarget(cue?.target, candidate?.analysis)
  let score = result.score
  const vocal = Number(candidate?.analysis?.vocal)
  const want = cue?.vocal ?? 'any'
  if (Number.isFinite(vocal) && vocal > 0.5 && want === 'none') {
    score = Number((score * 0.85).toFixed(3))
  }
  return { score, coverage: result.coverage, parts: result.parts }
}

/** 这段所有候选，按得分降序（稳定排序，同分保留原顺序）。 */
export function rankCandidates(cue) {
  const list = Array.isArray(cue?.candidates) ? cue.candidates : []
  return list
    .map((candidate, index) => ({ candidate, index, ...scoreCandidate(cue, candidate) }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
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

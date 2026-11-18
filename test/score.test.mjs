import test from 'node:test'
import assert from 'node:assert/strict'
import { avoidFactor, effectiveCount, matchLevel, rankCandidates, scoreCandidate, scoreTarget, topTags } from '../lib/score.js'

const target = [
  { tag: 'horror', weight: 0.6 },
  { tag: 'dark', weight: 0.4 }
]

test('scoreTarget 是加权平均，不是 max', () => {
  const a = scoreTarget(target, { probs: { horror: 0.8, dark: 0.2 } })
  assert.equal(a.coverage, 1)
  assert.equal(a.score, 0.56) // 0.6*0.8 + 0.4*0.2

  const b = scoreTarget(target, { probs: { horror: 0.2, dark: 0.8 } })
  assert.equal(b.score, 0.44)
  assert.ok(a.score > b.score)
})

test('缺失概率不按 0 算，而是扣分母并降低 coverage', () => {
  const out = scoreTarget(target, { probs: { horror: 0.9 } })
  assert.equal(out.coverage, 0.6)
  assert.equal(out.score, 0.9)
})

test('没有分析结果时得 0 分、coverage 0', () => {
  const out = scoreTarget(target, null)
  assert.equal(out.score, 0)
  assert.equal(out.coverage, 0)
})

test('rankCandidates 按分数降序且稳定', () => {
  const cue = {
    target,
    candidates: [
      { song_id: 1, analysis: { probs: { horror: 0.2, dark: 0.2 } } },
      { song_id: 2, analysis: { probs: { horror: 0.9, dark: 0.9 } } },
      { song_id: 3, analysis: { probs: { horror: 0.5, dark: 0.5 } } }
    ]
  }
  const ranked = rankCandidates(cue)
  assert.deepEqual(ranked.map((r) => r.candidate.song_id), [2, 3, 1])
})

test('人声惩罚：cue.vocal=none 全额、any 半额、wordless 不罚', () => {
  const probs = { horror: 0.8, dark: 0.8 }
  const opts = { vocalPenalty: 0.25, vocalThreshold: 0.25 }
  const none = scoreCandidate({ target, vocal: 'none' }, { analysis: { probs, vocal: 0.9 } }, opts)
  const any = scoreCandidate({ target, vocal: 'any' }, { analysis: { probs, vocal: 0.9 } }, opts)
  const wordless = scoreCandidate({ target, vocal: 'wordless' }, { analysis: { probs, vocal: 0.9 } }, opts)
  assert.ok(none.score < any.score)
  assert.ok(any.score < wordless.score)
  assert.equal(wordless.vocal, 1)
  // none + p=0.9：(0.9−0.25)/(1−0.25)=0.8667 → ×(1−0.25×0.8667)=×0.7833
  assert.equal(none.vocal, 0.7833)
})

test('人声惩罚：阈值以下不罚，没有概率也不罚', () => {
  const probs = { horror: 0.8, dark: 0.8 }
  const low = scoreCandidate({ target, vocal: 'none' }, { analysis: { probs, vocal: 0.1 } }, { vocalPenalty: 0.25, vocalThreshold: 0.25 })
  const missing = scoreCandidate({ target, vocal: 'none' }, { analysis: { probs, vocal: null } }, { vocalPenalty: 0.25, vocalThreshold: 0.25 })
  assert.equal(low.vocal, 1)
  assert.equal(missing.vocal, 1)
})

test('人声惩罚可关闭（penalty=0 时不影响得分）', () => {
  const probs = { horror: 0.8, dark: 0.8 }
  const cue = { target, vocal: 'none' }
  const off = scoreCandidate(cue, { analysis: { probs, vocal: 1 } }, { vocalPenalty: 0 })
  const on = scoreCandidate(cue, { analysis: { probs, vocal: 1 } }, { vocalPenalty: 0.25 })
  assert.equal(off.vocal, 1)
  assert.ok(on.score < off.score)
})

test('负向标签：乘性惩罚生效，基础分照旧', () => {
  const probs = { horror: 0.8, dark: 0.8, happy: 0.9, upbeat: 0.9 }
  const base = scoreCandidate({ target }, { analysis: { probs } })
  const avoided = scoreCandidate({
    target,
    avoidTargets: [{ tag: 'happy', weight: 0.5 }, { tag: 'upbeat', weight: 0.5 }]
  }, { analysis: { probs } })
  assert.ok(avoided.score < base.score)
  // base 0.8 × (1 − 0.6 × (0.5·0.9 + 0.5·0.9)) = 0.8 × 0.46
  assert.equal(avoided.avoid.factor, 0.46)
  assert.equal(avoided.score, Number((base.score * 0.46).toFixed(3)))
})

test('负向标签：k=0.6 封顶，最多压到 40%', () => {
  const probs = { horror: 1, dark: 1, happy: 1 }
  const cue = { target, avoidTargets: [{ tag: 'happy', weight: 1 }] }
  const out = scoreCandidate(cue, { analysis: { probs } })
  assert.equal(out.avoid.factor, 0.4)
  assert.ok(out.score > 0)          // 不会被压成负数或 0
  assert.equal(out.score, 0.4)      // base 1.0 × 0.4
})

test('负向标签：两个相关标签各自独立计分（不去重、不取最大值）', () => {
  const probs = { horror: 0.8, dark: 0.8, happy: 0.9, upbeat: 0.9 }
  // 合起来压 0.54；若只取最大值只会有 0.27
  const both = avoidFactor({
    avoidTargets: [{ tag: 'happy', weight: 0.5 }, { tag: 'upbeat', weight: 0.5 }]
  }, { analysis: { probs } })
  assert.equal(both.factor, 0.46)
  assert.equal(both.parts.length, 2)
  assert.ok(both.parts.every((p) => p.impact > 0))
})

test('负向标签：某个标签概率为 0 时它不贡献惩罚', () => {
  const out = avoidFactor({
    avoidTargets: [{ tag: 'happy', weight: 0.5 }, { tag: 'children', weight: 0.5 }]
  }, { analysis: { probs: { happy: 1, children: 0 } } })
  assert.equal(out.factor, 0.7) // 1 − 0.6×0.5
})

test('effectiveCount：负向标签把有效候选压到 <3 首时可被检测到', () => {
  // 基础分 0.6×0.2 + 0.4×0.2 = 0.2；加 happy 负向标签后最高只剩 0.2×0.46 = 0.092
  const mk = (happy) => ({ analysis: { probs: { horror: 0.2, dark: 0.2, happy } } })
  const candidates = [mk(0.9), mk(0.8), mk(0.7), mk(0.2), mk(0.1)]
  const plain = { target, candidates }
  const avoided = { target, candidates, avoidTargets: [{ tag: 'happy', weight: 1 }] }
  assert.equal(effectiveCount(plain, 0.2), 5)
  assert.ok(effectiveCount(avoided, 0.2) < 3)
})

test('topTags 返回概率最高的前 n 个', () => {
  const tags = topTags({ probs: { horror: 0.7, dark: 0.5, calm: 0.1 } }, 2)
  assert.deepEqual(tags.map(([t]) => t), ['horror', 'dark'])
})

test('matchLevel 分档', () => {
  assert.equal(matchLevel(0.6), 'good')
  assert.equal(matchLevel(0.3), 'fair')
  assert.equal(matchLevel(0.1), 'poor')
  assert.equal(matchLevel(Number.NaN), 'unknown')
})
test('验收：给一段加 happy 后，原本头名的欢快曲掉出前 3', () => {
  const target = [{ tag: 'epic', weight: 0.5 }, { tag: 'powerful', weight: 0.5 }]
  const mk = (id, probs) => ({ song_id: id, analysis: { probs } })
  const candidates = [
    mk(1, { epic: 0.95, powerful: 0.95, happy: 0.95, funny: 0.8, upbeat: 0.9 }), // 头名：欢快
    mk(2, { epic: 0.8, powerful: 0.8, happy: 0.1 }),
    mk(3, { epic: 0.7, powerful: 0.7, happy: 0.2 }),
    mk(4, { epic: 0.6, powerful: 0.6, happy: 0.3 }),
    mk(5, { epic: 0.55, powerful: 0.55, happy: 0.1 })
  ]
  const before = rankCandidates({ target, candidates })
  assert.equal(before[0].candidate.song_id, 1)

  const after = rankCandidates({
    target,
    candidates,
    avoidTargets: [{ tag: 'happy', weight: 1 }]
  })
  const top3 = after.slice(0, 3).map((r) => r.candidate.song_id)
  assert.ok(!top3.includes(1), `欢快曲应掉出前 3，实际 ${top3.join(',')}`)
  assert.ok(after.every((r) => r.score >= 0))
})

test('验收：没有负向标签时排序与旧行为一致（旧表兼容）', () => {
  const target = [{ tag: 'horror', weight: 0.6 }, { tag: 'dark', weight: 0.4 }]
  const cue = { target, candidates: [
    { song_id: 1, analysis: { probs: { horror: 0.2, dark: 0.2 } } },
    { song_id: 2, analysis: { probs: { horror: 0.9, dark: 0.9 } } }
  ] }
  assert.deepEqual(rankCandidates(cue).map((r) => r.candidate.song_id), [2, 1])
})

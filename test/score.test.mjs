import test from 'node:test'
import assert from 'node:assert/strict'
import { matchLevel, rankCandidates, scoreCandidate, scoreTarget, topTags } from '../lib/score.js'

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

test('cue 要无人声而候选有人声时降一档', () => {
  const cue = { target, vocal: 'none' }
  const clean = scoreCandidate(cue, { analysis: { probs: { horror: 0.8, dark: 0.8 }, vocal: 0.1 } })
  const vocal = scoreCandidate(cue, { analysis: { probs: { horror: 0.8, dark: 0.8 }, vocal: 0.9 } })
  assert.ok(vocal.score < clean.score)
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

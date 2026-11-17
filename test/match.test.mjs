import test from 'node:test'
import assert from 'node:assert/strict'

import { cuePrompts, matchLevel } from '../lib/match.js'

test('标签给出基础词表，wants 里的关键词会追加', () => {
  const prompts = cuePrompts({
    scene: 'GPCA · 天线场',
    wants: ['太空 电子 辽阔'],
    tags: { valence: 'neutral', energy: 'building', texture: ['synth'], vocal: 'none' }
  })
  const labels = prompts.map((p) => p.label)
  assert.ok(labels.includes('合成器'), `应含合成器，实际 ${labels.join('/')}`)
  assert.ok(labels.includes('太空氛围'), `应含太空氛围，实际 ${labels.join('/')}`)
})

test('词表最多 6 条且不重复', () => {
  const prompts = cuePrompts({
    scene: '暴乱',
    wants: ['地震 轰鸣 燃烧 暴乱 雷暴 追逐 恐怖'],
    tags: { valence: 'dark', energy: 'burst', texture: ['percussion', 'drone'] }
  })
  assert.ok(prompts.length <= 6, `实际 ${prompts.length} 条`)
  assert.equal(new Set(prompts.map((p) => p.text)).size, prompts.length)
})

test('没有任何标签和 wants 时给一条兜底', () => {
  const prompts = cuePrompts({ scene: '' })
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].label, '器乐')
})

test('匹配度分档', () => {
  assert.equal(matchLevel(0.9), 'good')
  assert.equal(matchLevel(0.5), 'good')
  assert.equal(matchLevel(0.4), 'fair')
  assert.equal(matchLevel(0.25), 'fair')
  assert.equal(matchLevel(0.05), 'poor')
  assert.equal(matchLevel(undefined), 'unknown')
})


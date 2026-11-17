import test from 'node:test'
import assert from 'node:assert/strict'
import { FALLBACK_TAGS } from '../lib/tags.js'
import { TAG_LABELS, droppedHint, labelOf, tagOf } from '../lib/tagLabels.js'
import { analysisLine, targetLine } from '../lib/format.js'

test('56 个标签都有中文显示名，且没有重复中文名', () => {
  const missing = FALLBACK_TAGS.filter((tag) => !TAG_LABELS[tag])
  assert.deepEqual(missing, [], `缺中文名：${missing.join(', ')}`)
  const labels = FALLBACK_TAGS.map((tag) => TAG_LABELS[tag])
  assert.equal(new Set(labels).size, labels.length, '中文名有重复')
})

test('labelOf / tagOf 双向可用', () => {
  assert.equal(labelOf('dark'), '黑暗')
  assert.equal(labelOf('unknown-tag'), 'unknown-tag')
  assert.equal(tagOf('戏剧张力'), 'dramatic')
  assert.equal(tagOf('不存在'), '')
})

test('写中文显示名时，提示对应的英文标签', () => {
  assert.equal(droppedHint('黑暗'), '黑暗 → dark')
  assert.equal(droppedHint('戏剧张力'), '戏剧张力 → dramatic')
  assert.equal(droppedHint('horror'), 'horror')
})

test('表里显示中文，但数据仍是英文标签', () => {
  const line = targetLine([{ tag: 'dark', weight: 0.5 }, { tag: 'dramatic', weight: 0.5 }])
  assert.match(line, /黑暗 0\.50/)
  assert.match(line, /戏剧张力 0\.50/)
  assert.doesNotMatch(line, /dark/)

  const analysis = analysisLine({ probs: { dark: 0.72, dramatic: 0.58 } })
  assert.match(analysis, /黑暗 0\.72/)
})

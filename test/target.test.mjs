import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveTarget, normalizeTarget, primaryTag, targetTags } from '../lib/target.js'
import { FALLBACK_TAGS } from '../lib/tags.js'

const ALLOW = new Set(FALLBACK_TAGS)

test('normalizeTarget 去重、限制 6 个、权重和严格为 1', () => {
  const out = normalizeTarget([
    { tag: 'dark', weight: 2 },
    { tag: 'dark', weight: 1 },
    { tag: 'epic', weight: 1 },
    { tag: 'happy', weight: 1 }, { tag: 'sad', weight: 1 },
    { tag: 'calm', weight: 1 }, { tag: 'soft', weight: 1 }, { tag: 'groovy', weight: 1 }
  ], ALLOW)
  assert.ok(out.length <= 6)
  assert.equal(out.filter((x) => x.tag === 'dark').length, 1)
  const sum = out.reduce((acc, x) => acc + x.weight, 0)
  assert.equal(Number(sum.toFixed(2)), 1)
})

test('normalizeTarget 丢掉词表外的标签', () => {
  const out = normalizeTarget([{ tag: 'happy', weight: 1 }, { tag: '不存在', weight: 1 }], ALLOW)
  assert.deepEqual(targetTags(out), ['happy'])
})

test('deriveTarget：旧 tags 的 dark + static 能落到 dark/calm', () => {
  const out = deriveTarget({ scene: '夜路', tags: { valence: 'dark', energy: 'static' } }, ALLOW)
  const tags = targetTags(out)
  assert.ok(tags.includes('dark'))
  assert.ok(tags.includes('calm'))
})

test('deriveTarget：wants 里的中文能落到原生标签', () => {
  const horror = deriveTarget({ scene: '洞穴', wants: ['恐怖', '压迫'] }, ALLOW)
  assert.ok(targetTags(horror).includes('dark'))
  assert.ok(targetTags(horror).includes('heavy'))

  const cozy = deriveTarget({ scene: '营地', wants: ['温馨'] }, ALLOW)
  assert.ok(targetTags(cozy).includes('soft'))
})

test('deriveTarget：没有任何线索时给安全兜底', () => {
  const out = deriveTarget({ scene: '???' }, ALLOW)
  assert.ok(out.length >= 1)
  assert.equal(primaryTag(out), 'calm')
})

test('deriveTarget：迁移模式（allowed 为空）不丢标签', () => {
  const out = deriveTarget({ scene: 'x', tags: { valence: 'dark', energy: 'burst' } }, [])
  assert.ok(out.length >= 2)
})

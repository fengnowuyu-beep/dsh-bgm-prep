import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveAvoidInfo, deriveTarget, normalizeAvoidTargets, normalizeTarget, primaryTag, targetTags } from '../lib/target.js'
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
test('deriveAvoidInfo：调性忌讳落到原生标签', () => {
  const out = deriveAvoidInfo(['欢快'], ALLOW)
  const tags = targetTags(out.avoidTargets)
  assert.ok(tags.includes('happy'))
  assert.ok(tags.includes('upbeat'))
  assert.equal(out.unverified.length, 0)
})

test('deriveAvoidInfo：字面忌讳落到关键词，同时不丢标签', () => {
  const out = deriveAvoidInfo(['人声'], ALLOW)
  assert.ok(out.avoidKeywords.includes('vocal'))
  assert.ok(out.avoidKeywords.includes('feat'))
  // 「人声」对不上任何调性规则，但它有可用的字面线索，所以不算「无法验证」
  assert.equal(out.unverified.length, 0)
})

test('deriveAvoidInfo：两条都没对上的标「无法验证」', () => {
  const out = deriveAvoidInfo(['旋律太甜'], ALLOW)
  assert.deepEqual(out.avoidTargets, [])
  assert.deepEqual(out.avoidKeywords, [])
  assert.deepEqual(out.unverified, ['旋律太甜'])
})

test('deriveAvoidInfo：标签权重归一化', () => {
  const out = deriveAvoidInfo(['恐怖', '欢快'], ALLOW)
  const sum = out.avoidTargets.reduce((acc, x) => acc + x.weight, 0)
  assert.ok(out.avoidTargets.length >= 2)
  assert.equal(Number(sum.toFixed(2)), 1)
})
test('normalizeAvoidTargets：按实际数量归一化（3 个不等于 5 个）', () => {
  const three = normalizeAvoidTargets([
    { tag: 'happy', weight: 1 }, { tag: 'upbeat', weight: 1 }, { tag: 'fun', weight: 1 }
  ], ALLOW)
  assert.equal(three.length, 3)
  assert.equal(Number(three.reduce((a, x) => a + x.weight, 0).toFixed(2)), 1)
  // 3 个摊成 1/3（舍入余量补到第一个 → 0.34），而不是固定除以 5 的 0.2
  assert.ok(three[0].weight >= 0.33)

  const five = normalizeAvoidTargets([
    { tag: 'happy', weight: 1 }, { tag: 'upbeat', weight: 1 }, { tag: 'fun', weight: 1 },
    { tag: 'party', weight: 1 }, { tag: 'children', weight: 1 }
  ], ALLOW)
  assert.equal(five.length, 5)
  assert.equal(Number(five.reduce((a, x) => a + x.weight, 0).toFixed(2)), 1)
  assert.equal(Number(five[0].weight.toFixed(2)), 0.2)
})

test('normalizeAvoidTargets：词表外标签丢弃、同标签合并不重复计分', () => {
  const out = normalizeAvoidTargets([
    { tag: 'happy', weight: 1 }, { tag: '不存在', weight: 1 }, { tag: 'happy', weight: 1 }
  ], ALLOW)
  assert.equal(out.length, 1)
  assert.equal(out[0].tag, 'happy')
  assert.equal(out[0].weight, 1)
})

test('normalizeAvoidTargets：不写死数量上限（6 个也接受）', () => {
  const six = normalizeAvoidTargets([
    { tag: 'happy', weight: 1 }, { tag: 'upbeat', weight: 1 }, { tag: 'fun', weight: 1 },
    { tag: 'party', weight: 1 }, { tag: 'children', weight: 1 }, { tag: 'holiday', weight: 1 }
  ], ALLOW)
  assert.equal(six.length, 6)
})

// 曲目表归一化：重点是「缺失」不能被压成 0（2026-11-18 的 I2），
// 以及 avoids 进来之后要能翻成可执行/可展示的信息（I4）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSheet } from '../lib/store.js'
import { FALLBACK_TAGS } from '../lib/tags.js'

const ALLOW = FALLBACK_TAGS

function sheetWith(analysis, extra = {}) {
  return {
    scope: 'test',
    cues: [{
      id: 's1',
      scene: '第一段',
      need_bgm: true,
      target: [{ tag: 'dark', weight: 1 }],
      candidates: [{ song_id: 1, title: 'T', artist: 'A', album: '', duration: 200, analysis }],
      ...extra
    }]
  }
}

test('analysis.vocal / stability 的 null 不会被改写成 0', () => {
  const sheet = normalizeSheet(sheetWith({ probs: { dark: 0.5 }, vocal: null, stability: null, engine: 'e', at: 't' }), 'x', ALLOW)
  const a = sheet.cues[0].candidates[0].analysis
  assert.equal(a.vocal, null)
  assert.equal(a.stability, null)
})

test('确证为 0 的值保持 0', () => {
  const sheet = normalizeSheet(sheetWith({ probs: { dark: 0.5 }, vocal: 0, stability: 0, engine: 'e', at: 't' }), 'x', ALLOW)
  const a = sheet.cues[0].candidates[0].analysis
  assert.equal(a.vocal, 0)
  assert.equal(a.stability, 0)
})

test('avoids 翻成负向标签 / 关键词 / 无法验证三类', () => {
  const sheet = normalizeSheet(sheetWith(null, { avoids: ['人声', '欢快', '旋律太甜'] }), 'x', ALLOW)
  const cue = sheet.cues[0]
  assert.deepEqual(cue.avoids, ['人声', '欢快', '旋律太甜'])
  assert.ok(cue.avoidTargets.some((x) => x.tag === 'happy'))
  assert.ok(cue.avoidKeywords.includes('vocal'))
  assert.deepEqual(cue.avoidUnverified, ['旋律太甜'])
})

test('显式 avoidTargets 优先，且按实际数量归一化', () => {
  const sheet = normalizeSheet(sheetWith(null, {
    avoids: ['欢快'],
    avoidTargets: [{ tag: 'funny', weight: 1 }, { tag: 'children', weight: 2 }]
  }), 'x', ALLOW)
  const cue = sheet.cues[0]
  assert.deepEqual(cue.avoidTargets.map((x) => x.tag).sort(), ['children', 'funny'])
  // 显式给了就不再叠加 avoids 的映射（happy/upbeat 不应出现）
  assert.ok(!cue.avoidTargets.some((x) => x.tag === 'happy'))
  assert.equal(Number(cue.avoidTargets.reduce((a, x) => a + x.weight, 0).toFixed(2)), 1)
})

test('旧表没有 avoidTargets 字段时按空处理', () => {
  const sheet = normalizeSheet(sheetWith(null), 'x', ALLOW)
  assert.deepEqual(sheet.cues[0].avoidTargets, [])
})
test('旧表遗留的 avoidTags 字段被忽略，不影响读取', () => {
  const sheet = normalizeSheet(sheetWith(null, { avoidTags: [{ tag: 'happy', weight: 1 }] }), 'x', ALLOW)
  const cue = sheet.cues[0]
  assert.deepEqual(cue.avoidTargets, [])
  assert.equal(cue.avoidTags, undefined)
})
test('显式空数组 = 用户清空忌项，不再从 avoids 自动补回', () => {
  const sheet = normalizeSheet(sheetWith(null, { avoids: ['欢快'], avoidTargets: [] }), 'x', ALLOW)
  assert.deepEqual(sheet.cues[0].avoidTargets, [])
})

import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// 每个测试文件单独进程：这里改 DSH_HOME 只影响本文件。
const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'bgm-db-'))
process.env.DSH_HOME = home

const db = await import('../lib/analysisDb.js')

test('写入后能读回，且按 engine 隔离', async () => {
  const payload = {
    probs: { dark: 0.8, calm: 0.2 },
    va: { valence: 2, arousal: 7 },
    stability: 0.1,
    at: '2026-11-18T00:00:00Z'
  }
  assert.equal(await db.writeAnalysis(1, 'v1', payload), true)

  const hit = await db.readAnalysis(1, 'v1')
  assert.deepEqual(hit.probs, payload.probs)
  assert.deepEqual(hit.va, payload.va)
  assert.equal(hit.stability, 0.1)

  assert.equal(await db.readAnalysis(1, 'v2'), null, '不同 engine 不应串')
  assert.equal(await db.readAnalysis(2, 'v1'), null)
  assert.ok((await db.countAnalysis()) >= 1)
})

test('同一首歌同一 engine 覆盖写', async () => {
  await db.writeAnalysis(9, 'v1', { probs: { dark: 0.1 }, va: null })
  await db.writeAnalysis(9, 'v1', { probs: { dark: 0.9 }, va: null })
  const hit = await db.readAnalysis(9, 'v1')
  assert.equal(hit.probs.dark, 0.9)
})

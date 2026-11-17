import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readSheet, writeSheet, SCHEMA } from '../lib/store.js'

async function tmpFile(content) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bgm-migrate-'))
  const file = path.join(dir, 'x.cues.json')
  await fsp.writeFile(file, JSON.stringify(content, null, 2), 'utf8')
  return { dir, file }
}

const legacy = {
  schema: 1,
  module: '黑水溪',
  session: 2,
  scope: 's2',
  directives: [],
  cues: [{
    id: 'c01',
    scene: '密斯卡托尼克山口 · 大地的心跳',
    trigger: '听见大地深处每四十秒一次的搏动',
    need_bgm: true,
    state: 'ready',
    tags: { tension: 8, valence: 'dark', energy: 'static', texture: ['drone'], vocal: 'none' },
    wants: ['低频', '心跳'],
    avoids: [],
    candidates: [{
      song_id: 1,
      title: 'old',
      auto: { top: [['恐怖配乐', 0.87]], match: 0.87, matchLabel: '恐怖配乐' },
      analysis: undefined
    }],
    picks: { primary: { song_id: 1, title: 'old' } },
    rejected: [2],
    note: ''
  }]
}

test('schema1 → 2：自动推导 target，丢弃旧 auto 分，保留 picks', async () => {
  const { dir, file } = await tmpFile(legacy)
  try {
    const sheet = await readSheet(file)
    assert.equal(sheet.schema, SCHEMA)
    const cue = sheet.cues[0]
    assert.ok(Array.isArray(cue.target) && cue.target.length > 0)
    assert.ok(cue.target.some((t) => t.tag === 'horror') || cue.target.some((t) => t.tag === 'dark'))
    assert.equal(cue.candidates[0].auto, undefined)
    assert.equal(cue.candidates[0].analysis, null)
    assert.equal(cue.picks.primary.song_id, 1)
    assert.deepEqual(cue.rejected, [2])
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

test('写回后落盘为 schema 2，且不再出现 auto', async () => {
  const { dir, file } = await tmpFile(legacy)
  try {
    const sheet = await readSheet(file)
    await writeSheet(file, sheet)
    const raw = JSON.parse(await fsp.readFile(file, 'utf8'))
    assert.equal(raw.schema, SCHEMA)
    assert.equal(raw.cues[0].candidates[0].auto, undefined)
    assert.ok(Array.isArray(raw.cues[0].target))
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// bgm_tag 的整合测试：用假 Python 跑通「分批 + 返回体 + 写回曲目表」。
const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'bgm-tagtool-'))
process.env.DSH_HOME = home
process.env.FAKE_MODE = 'ok'
process.env.FAKE_LOG = path.join(home, 'fake.log')

const fakeScript = fileURLToPath(new URL('./fixtures/fake-analyze.mjs', import.meta.url))
const codeDir = path.join(home, 'code')
const modelsDir = path.join(home, 'models')
await fsp.mkdir(codeDir, { recursive: true })
await fsp.mkdir(modelsDir, { recursive: true })
await fsp.mkdir(path.join(home, 'bgm-prep'), { recursive: true })
await fsp.writeFile(path.join(home, 'bgm-prep', 'settings.json'), JSON.stringify({
  analysis: {
    engine: 'music2emo',
    python: process.execPath,
    script: fakeScript,
    code: codeDir,
    models: modelsDir,
    version: 'test-v1',
    perSongTimeoutMs: 10000,
    totalBudgetMs: 120000,
    batchSize: 8,
    threads: 2,
    audioCacheMaxBytes: 1024 * 1024 * 1024
  }
}, null, 2), 'utf8')

const realFetch = globalThis.fetch
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  json: async () => ({ data: [{ url: 'https://example.test/audio.mp3' }] })
})

const { apply } = await import('../lib/index.js')

function loadTools() {
  const tools = new Map()
  apply({ tools: { register: (tool) => tools.set(tool.name, tool) }, logger: {} })
  return tools
}

function execFor(cwd) {
  return { agent: { session: { header: { cwd } } } }
}

test('bgm_tag：默认 24 首一批，超出的留到 remaining，再调一次补齐', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bgm-tag-'))
  const file = path.join(dir, 'bgm', 'x.cues.json')
  const tools = loadTools()
  const exec = execFor(dir)

  const init = await tools.get('bgm_init').execute({
    file, module: '测试', scope: 'x', cues: [{ scene: '甲' }, { scene: '乙' }]
  }, exec)
  assert.equal(init.ok, true, JSON.stringify(init))

  const sheet = JSON.parse(await fsp.readFile(file, 'utf8'))
  sheet.cues[0].candidates = Array.from({ length: 20 }, (_, i) => ({
    song_id: 9000 + i, title: `甲-${i}`, artist: 'A', album: '', duration: 200
  }))
  sheet.cues[1].candidates = Array.from({ length: 6 }, (_, i) => ({
    song_id: 9100 + i, title: `乙-${i}`, artist: 'B', album: '', duration: 200
  }))
  await fsp.writeFile(file, JSON.stringify(sheet, null, 2), 'utf8')

  const first = await tools.get('bgm_tag').execute({ file, per_cue: 20 }, exec)
  assert.equal(first.ok, true, JSON.stringify(first))
  assert.equal(first.tried, 24)
  assert.equal(first.analyzed, 24)
  assert.equal(first.batches, 3)
  assert.equal(first.remaining, 2)
  assert.equal(first.partial, true)
  assert.equal(first.stopReason, 'max_songs')
  assert.equal(first.store, 'sqlite')

  const rendered = tools.get('bgm_tag').output.render(null, first).map((part) => part.text).join('\n')
  // 口径：主数字是「本次可用 = 新分析 + 缓存」，不再只报新分析数
  assert.match(rendered, /本次可用 24 首（新分析 24 \+ 缓存命中 0/)
  assert.match(rendered, /还剩 2 首没尝试过/)
  assert.match(rendered, /本次上限/)
  assert.match(rendered, /写回 24 首的段内得分/)

  const afterFirst = JSON.parse(await fsp.readFile(file, 'utf8'))
  const analyzedIds = [...afterFirst.cues[0].candidates, ...afterFirst.cues[1].candidates]
    .filter((c) => c.analysis?.probs).map((c) => c.song_id)
  assert.equal(analyzedIds.length, 24)
  assert.deepEqual(analyzedIds, [
    ...Array.from({ length: 20 }, (_, i) => 9000 + i),
    ...Array.from({ length: 4 }, (_, i) => 9100 + i)
  ])
  assert.ok(fs.existsSync(file))

  const second = await tools.get('bgm_tag').execute({ file, per_cue: 20 }, exec)
  assert.equal(second.ok, true, JSON.stringify(second))
  assert.equal(second.tried, 2)
  assert.equal(second.analyzed, 2)
  assert.equal(second.remaining, 0)
  assert.equal(second.partial, false)
  assert.equal(second.stopReason, '')

  const afterSecond = JSON.parse(await fsp.readFile(file, 'utf8'))
  const all = [...afterSecond.cues[0].candidates, ...afterSecond.cues[1].candidates]
  assert.equal(all.filter((c) => c.analysis?.probs).length, 26)
})

test.after(() => {
  globalThis.fetch = realFetch
})

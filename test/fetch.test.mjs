// 用假 CLI 验证 bgm_fetch 全链路：搜歌 → 去噪去重 → 打分 → 写回 candidates。
// 不访问网络、不需要真实登录。

import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

process.env.NCM_CLI = fileURLToPath(new URL('../tools/fake-cli.mjs', import.meta.url))
process.env.DSH_HOME = await fsp.mkdtemp(path.join(os.tmpdir(), 'bgm-home-'))

const { apply } = await import('../lib/index.js')

function loadTools() {
  const tools = new Map()
  apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: {} })
  return tools
}

test('bgm_fetch 走通：搜歌 → 过滤 Live/翻唱/过短/不可播 → 写回候选', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bgm-fetch-'))
  const file = path.join(dir, 'bgm', 'act1.cues.json')
  const tools = loadTools()
  const exec = { agent: { session: { header: { cwd: dir } } } }

  const init = await tools.get('bgm_init').execute({
    file, module: 'mock', session: 1, scope: 'act1',
    cues: [
      { scene: '地窖 · 石阶', trigger: '走下去', need_bgm: true, tags: { valence: 'dark', energy: 'static', texture: ['drone'], vocal: 'none' } },
      { scene: '档案室', need_bgm: false }
    ]
  }, exec)
  assert.equal(init.ok, true, JSON.stringify(init))

  const r = await tools.get('bgm_fetch').execute({ file }, exec)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.filled, 1)

  const sheet = JSON.parse(await fsp.readFile(file, 'utf8'))
  const ids = sheet.cues[0].candidates.map((c) => c.song_id)
  assert.ok(ids.length >= 2, '应有候选')
  assert.ok(!ids.includes(12), 'Live 版应被过滤')
  assert.ok(!ids.includes(15), '翻唱应被过滤')
  assert.ok(!ids.includes(16), '过短的应被过滤')
  assert.ok(!ids.includes(17), 'playFlag=false 应被过滤')
  assert.equal(new Set(ids).size, ids.length, '不应有重复')
  assert.ok(sheet.cues[0].candidates.every((c) => c.encrypted_id), '候选应带 encrypted_id')

  // 第二遍不该再检索（已有候选且未 force）
  const again = await tools.get('bgm_fetch').execute({ file }, exec)
  assert.equal(again.filled, 0)

  // 非法 id 仍被拒
  const bad = await tools.get('bgm_pick').execute({ file, picks: [{ cue_id: 'c01', primary: { song_id: 999999, why: '编的' } }] }, exec)
  assert.equal(bad.ok, false)
})

test('force 重跑会清空旧候选并重新填', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bgm-fetch2-'))
  const file = path.join(dir, 'bgm', 'act2.cues.json')
  const tools = loadTools()
  const exec = { agent: { session: { header: { cwd: dir } } } }
  await tools.get('bgm_init').execute({
    file, module: 'mock2', session: 1, scope: 'act2',
    cues: [{ scene: '码头 夜袭', need_bgm: true }]
  }, exec)
  const first = await tools.get('bgm_fetch').execute({ file }, exec)
  assert.equal(first.filled, 1)
  const second = await tools.get('bgm_fetch').execute({ file, force: true }, exec)
  assert.equal(second.filled, 1)
})
test('bgm_fetch 的返回文案：没检索的段算「没有候选」，已有候选才算「待定选」', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bgm-msg-'))
  const file = path.join(dir, 'bgm', 'act1.cues.json')
  const tools = loadTools()
  const exec = { agent: { session: { header: { cwd: dir } } } }

  const init = await tools.get('bgm_init').execute({
    file, module: 'mock', session: 1, scope: 'act1',
    cues: [
      { id: 's1', scene: '地窖', need_bgm: true },
      { id: 's2', scene: '档案室', need_bgm: true },
      { id: 's3', scene: '码头', need_bgm: true }
    ]
  }, exec)
  assert.equal(init.ok, true, JSON.stringify(init))

  const one = await tools.get('bgm_fetch').execute({ file, cue_ids: ['s1'] }, exec)
  assert.equal(one.ok, true, JSON.stringify(one))
  assert.match(one.next, /2 段没有候选（待检索）/)
  assert.match(one.next, /1 段已有候选，待定选/)
  assert.doesNotMatch(one.next, /3 段已有候选/)

  const more = await tools.get('bgm_fetch').execute({ file, cue_ids: ['s2', 's3'] }, exec)
  assert.equal(more.ok, true, JSON.stringify(more))
  assert.match(more.next, /3 段已有候选，待定选/)
  assert.doesNotMatch(more.next, /没有候选/)
})

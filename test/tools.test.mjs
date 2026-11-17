import assert from 'node:assert/strict'
import fs from 'node:fs'
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

function execFor(cwd) {
  return { agent: { session: { header: { cwd } } } }
}

test('端到端（离线四件套）：init → view → pick → commit', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bgm-prep-'))
  const file = path.join(dir, 'bgm', 's3-act3.cues.json')
  const tools = loadTools()
  const exec = execFor(dir)

  const init = await tools.get('bgm_init').execute({
    file,
    module: '测试模组',
    session: 3,
    scope: 's3-act3',
    directives: [{ text: '少用钢琴', effect: { exclude_texture: ['piano'] } }],
    cues: [
      { scene: '地窖 · 封蜡信', trigger: '玩家走下石阶', need_bgm: true, tags: { valence: 'dark', energy: 'static', texture: ['drone'], vocal: 'none' } },
      { scene: '档案室 · 翻卷宗', need_bgm: false },
      { scene: '码头 · 夜袭', trigger: '船靠岸时被伏击', need_bgm: true, tags: { valence: 'dark', energy: 'driving', texture: ['percussion'] } }
    ]
  }, exec)
  assert.equal(init.ok, true, JSON.stringify(init))
  assert.equal(init.cueCount, 3)
  assert.equal(init.needBgmCount, 2)
  assert.match(init.table, /第 1 段/)
  assert.match(init.table, /\[(dark|calm|drone)/, '目标标签应出现在 L1 表里')
  assert.ok(fs.existsSync(file))

  const again = await tools.get('bgm_init').execute({ file, module: 'x', scope: 's3-act3', cues: [{ scene: 'z' }] }, exec)
  assert.equal(again.ok, false)
  assert.match(String(again.error), /已存在/)

  // 塞候选（带 encrypted_id，供建歌单用）
  const sheet = JSON.parse(await fsp.readFile(file, 'utf8'))
  sheet.cues[0].candidates = [{ song_id: 111, encrypted_id: 'Z'.repeat(32), title: '低频垫底', artist: 'A', album: '', duration: 240 }]
  sheet.cues[2].candidates = [{ song_id: 222, encrypted_id: 'Y'.repeat(32), title: '急促推进', artist: 'B', album: '', duration: 200 }]
  await fsp.writeFile(file, JSON.stringify(sheet, null, 2), 'utf8')

  const bad = await tools.get('bgm_pick').execute({ file, picks: [{ cue_id: 'c01', primary: { song_id: 999, why: '编的' } }] }, exec)
  assert.equal(bad.ok, false)
  assert.match(bad.rejectedInputs.join(), /不在候选里/)

  const good = await tools.get('bgm_pick').execute({
    file,
    picks: [
      { cue_id: 'c01', primary: { song_id: 111, why: '低频垫底无鼓点' } },
      { cue_id: 'c03', primary: { song_id: 222, why: '短促推进' } }
    ]
  }, exec)
  assert.equal(good.ok, true, JSON.stringify(good.rejectedInputs))
  assert.equal(good.accepted, 2)
  assert.match(good.table, /低频垫底/)

  const view = await tools.get('bgm_view').execute({ file, scope: 'full' }, exec)
  assert.equal(view.ok, true)
  assert.match(view.status, /已选 2/)

  const commit = await tools.get('bgm_commit').execute({ file }, exec)
  assert.equal(commit.ok, true, JSON.stringify(commit))
  assert.equal(commit.total, 2)
  assert.equal(commit.added, 2, '两首都应被加入歌单')
  assert.ok(commit.playlistId, '应拿到歌单 ID')
  assert.equal(commit.files.length, 3)
  for (const f of commit.files) assert.ok(fs.existsSync(f), f)

  const txt = await fsp.readFile(path.join(dir, 'bgm', 's3-act3.playlist.txt'), 'utf8')
  assert.match(txt, /低频垫底 - A/)
  const csv = await fsp.readFile(path.join(dir, 'bgm', 's3-act3.playlist.csv'), 'utf8')
  assert.ok(csv.startsWith('\ufeff'), 'CSV 必须带 BOM')
  assert.match(csv, /111/)

  const baks = (await fsp.readdir(path.join(dir, 'bgm'))).filter((n) => n.includes('.bak-'))
  assert.ok(baks.length >= 1, '每次写入应留备份')

  // 幂等：再跑一次不应新建歌单、也不应重复加曲
  const sheetAfter = JSON.parse(await fsp.readFile(file, 'utf8'))
  assert.equal(sheetAfter.playlist_id, '9'.repeat(32))
  const commit2 = await tools.get('bgm_commit').execute({ file }, exec)
  assert.equal(commit2.ok, true)
  assert.equal(commit2.playlistId, '9'.repeat(32), '应复用已有歌单')
})

test('patch 模式只改指定段，不动其它段的选曲', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bgm-prep-'))
  const file = path.join(dir, 'bgm', 'x.cues.json')
  const tools = loadTools()
  const exec = execFor(dir)

  await tools.get('bgm_init').execute({ file, module: 'm', scope: 'x', cues: [{ scene: 'a' }, { scene: 'b' }] }, exec)
  const sheet = JSON.parse(await fsp.readFile(file, 'utf8'))
  sheet.cues[0].candidates = [{ song_id: 7, title: 't', artist: 'a', album: '', duration: 200 }]
  sheet.cues[0].picks = { primary: { song_id: 7, why: '保留我' }, alts: [] }
  await fsp.writeFile(file, JSON.stringify(sheet, null, 2), 'utf8')

  const patched = await tools.get('bgm_init').execute({
    file, module: 'm', scope: 'x', mode: 'patch', cues: [{ id: 'c02', scene: 'b 改名' }]
  }, exec)
  assert.equal(patched.ok, true, JSON.stringify(patched))

  const after = JSON.parse(await fsp.readFile(file, 'utf8'))
  assert.equal(after.cues[0].picks.primary.why, '保留我')
  assert.equal(after.cues[1].scene, 'b 改名')
})


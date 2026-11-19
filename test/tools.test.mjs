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
  assert.match(init.table, /\[(黑暗|平静)/, '目标标签应出现在 L1 表里')
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

// 歌单命名：模组中文名-YYMMDD-作者（作者默认枫笛），且总长 ≤ 40 GBK 字节
async function previewPlaylistName(module) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bgm-name-'))
  const file = path.join(dir, 'bgm', 'name.cues.json')
  const tools = loadTools()
  const exec = execFor(dir)
  await tools.get('bgm_init').execute({ file, module, scope: 'name', cues: [{ scene: 'a', need_bgm: true }] }, exec)
  const sheet = JSON.parse(await fsp.readFile(file, 'utf8'))
  sheet.cues[0].candidates = [{ song_id: 1, encrypted_id: 'X'.repeat(32), title: 't', artist: 'a', album: '', duration: 200 }]
  sheet.cues[0].picks = { primary: { song_id: 1, why: '测试' }, alts: [] }
  await fsp.writeFile(file, JSON.stringify(sheet, null, 2), 'utf8')
  const preview = await tools.get('bgm_commit').execute({ file, dry_run: true }, exec)
  assert.equal(preview.ok, true, JSON.stringify(preview))
  return preview.playlist
}

const gbkLength = (text) => {
  let units = 0
  for (const ch of text) units += ch.codePointAt(0) <= 0x7f ? 1 : 2
  return units
}

test('歌单命名：模组中文名-YYMMDD-作者，英文副标题不进名字', async () => {
  const name = await previewPlaylistName('小瓢虫快回家 LADYBUG, LADYBUG, FLY AWAY HOME')
  const d = new Date()
  const yymmdd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  assert.equal(name, `小瓢虫快回家-${yymmdd}-枫笛`)
  assert.ok(gbkLength(name) <= 40, `GBK ${gbkLength(name)} 字节：${name}`)
})

test('歌单名超过 40 个 GBK 字节要截断（网易云 create 会直接回 500）', async () => {
  // 24 个汉字 = 48 字节，加日期作者必然超限
  const long = '一个特别特别特别特别特别特别长的模组中文名字'
  const name = await previewPlaylistName(long)
  assert.ok(gbkLength(name) <= 40, `GBK ${gbkLength(name)} 字节：${name}`)
  assert.match(name, /…/, '截断应带省略号，避免断在半截')
  assert.match(name, /-\d{6}-枫笛$/, '日期和作者不能被截掉')
})

test('歌单绑定要能读回来：commit 第二次必须复用同一个歌单', async () => {
  // normalizeSheet 曾经把 playlist_id / playlist_name 丢掉 → 每次 commit 都新建同名歌单。
  // fake CLI 的 create 返回固定 id，所以旧的幂等断言看不出来；这里直接改 id 再读回。
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bgm-reuse-'))
  const file = path.join(dir, 'bgm', 'reuse.cues.json')
  const tools = loadTools()
  const exec = execFor(dir)

  await tools.get('bgm_init').execute({ file, module: '复用测试', scope: 'reuse', cues: [{ scene: 'a', need_bgm: true }] }, exec)
  const sheet = JSON.parse(await fsp.readFile(file, 'utf8'))
  sheet.cues[0].candidates = [{ song_id: 1, encrypted_id: 'X'.repeat(32), title: 't', artist: 'a', album: '', duration: 200 }]
  sheet.cues[0].picks = { primary: { song_id: 1, why: '测试' }, alts: [] }
  sheet.playlist_id = '7'.repeat(32)
  sheet.playlist_name = 'day-module-BGM'
  await fsp.writeFile(file, JSON.stringify(sheet, null, 2), 'utf8')

  const preview = await tools.get('bgm_commit').execute({ file, dry_run: true }, exec)
  assert.equal(preview.ok, true, JSON.stringify(preview))
  assert.equal(preview.playlistId, '7'.repeat(32), '已绑定的歌单 id 必须读得回来')
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
// 回归：DSH 的工具 schema 校验不接受 type 数组（如 ['number','null']）。
// 2026-11-19 因为 bgm_tag 的 probes.poolMatch 写了 type 数组，整个插件在加载阶段就 failed，
// 七个工具一个都注册不上——单测全绿也发现不了，只有真加载才看得见。
test('工具 schema 兼容 DSH 校验：每个 type 都必须是单个字符串', () => {
  const tools = loadTools()
  const bad = []
  const walk = (node, at) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node.type)) bad.push(`${at}.type = ${JSON.stringify(node.type)}`)
    for (const [key, value] of Object.entries(node)) {
      if (key === 'type') continue
      walk(value, `${at}.${key}`)
    }
  }
  for (const [name, tool] of tools) {
    walk(tool.parameters, `${name}.parameters`)
    walk(tool.output?.schema, `${name}.output`)
  }
  assert.deepEqual(bad, [], `DSH 不支持 type 数组：${bad.join('; ')}`)
})

test('bgm_init 写 avoidTargets：按实际数量归一化，表格里能看到负向标签', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bgm-avoid-'))
  const file = path.join(dir, 'bgm', 'a.cues.json')
  const tools = loadTools()
  const exec = execFor(dir)
  const init = await tools.get('bgm_init').execute({
    file,
    module: '负向标签测试',
    scope: 'a',
    cues: [{
      scene: '地窖 · 熄灯',
      need_bgm: true,
      target: [{ tag: 'dark', weight: 1 }],
      avoidTargets: [{ tag: 'happy', weight: 1 }, { tag: 'upbeat', weight: 1 }, { tag: 'funny', weight: 1 }]
    }]
  }, exec)
  assert.equal(init.ok, true)
  assert.match(init.table, /负向标签 \[/)
  const saved = JSON.parse(await fsp.readFile(file, 'utf8'))
  const cue = saved.cues[0]
  assert.equal(cue.avoidTargets.length, 3)
  assert.equal(Number(cue.avoidTargets.reduce((a, x) => a + x.weight, 0).toFixed(2)), 1)
  // 正向目标不受影响
  assert.deepEqual(cue.target.map((x) => x.tag), ['dark'])
})


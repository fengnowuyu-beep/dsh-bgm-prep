// 2026-11-19 优化项的回归测试：一阶段粗筛、检索词、种子补位、字段口径、
// 候选可见性、跨 scope 合表、自检工具。
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

process.env.NCM_CLI = fileURLToPath(new URL('../tools/fake-cli.mjs', import.meta.url))
process.env.DSH_HOME = await fsp.mkdtemp(path.join(os.tmpdir(), 'bgm-home-opt-'))

const { prepareCandidates, originOf, ORIGIN_RANK } = await import('../lib/filter.js')
const { SEARCH_WORDS, SEED_TOPPING, buildQueries, pickSeedTopping } = await import('../lib/search.js')
const { normalizeSheet } = await import('../lib/store.js')
const { mergeSheets, renderCombinedReview, renderTable } = await import('../lib/format.js')
const { apply } = await import('../lib/index.js')

function mkTrack(id, title, origin) {
  return { song_id: id, title, artist: `A${id}`, album: '', duration: 200, origin }
}

test('P0-1 候选排序：主题歌单优先于搜索/种子，且不再按段随机', () => {
  const tracks = [
    mkTrack(1, 'Alpha', 'seed'),
    mkTrack(2, 'Beta', 'playlist'),
    mkTrack(3, 'Gamma', 'search'),
    mkTrack(4, 'Delta', 'playlist'),
    mkTrack(5, 'Epsilon', 'seed')
  ]
  const first = prepareCandidates(tracks, { limit: 5 })
  const second = prepareCandidates(tracks, { limit: 5 })

  // 同样的输入两次结果必须一致（旧实现按 salt 哈希，换段就换顺序）
  assert.deepEqual(first.map((t) => t.song_id), second.map((t) => t.song_id))
  // 主题歌单的两首必须排在最前面
  assert.deepEqual(first.slice(0, 2).map((t) => t.origin), ['playlist', 'playlist'])
  // 种子歌单排在最后
  assert.equal(first[first.length - 1].origin, 'seed')
  // 抓取期只写 fetchScore，不写含义模糊的 score
  assert.ok(first.every((t) => t.score === undefined))
  assert.ok(first.every((t) => Number.isFinite(t.fetchScore)))
  assert.equal(ORIGIN_RANK.playlist > ORIGIN_RANK.search, true)
  assert.equal(ORIGIN_RANK.search >= ORIGIN_RANK.seed, true)
})

test('P0-1 来源识别：靠 source 字符串也能认出种子/搜歌', () => {
  assert.equal(originOf({ source: '我的种子歌单' }), 'seed')
  assert.equal(originOf({ source: '歌曲搜索：黑暗' }), 'search')
  assert.equal(originOf({ source: '克苏鲁 | 万物起源' }), 'playlist')
  assert.equal(originOf({ origin: 'seed', source: '克苏鲁' }), 'seed', '显式 origin 优先')
  assert.equal(originOf({}), 'unknown')
})

test('P0-1 默认每段留 12 首，不再固定 8', () => {
  const tracks = Array.from({ length: 20 }, (_, i) => mkTrack(100 + i, `T${i}`, 'playlist'))
  assert.equal(prepareCandidates(tracks, {}).length, 12)
  assert.equal(prepareCandidates(tracks, { limit: 5 }).length, 5)
})

test('P0-2 wants 前两条都会生效，第三条被忽略', () => {
  const cue = { wants: ['克苏鲁 背景音乐', '宗教 圣咏 恐怖', '第三条不该出现'], target: [{ tag: 'dark', weight: 1 }] }
  const queries = buildQueries(cue)
  assert.ok(queries.includes('克苏鲁 背景音乐'))
  assert.ok(queries.includes('宗教 圣咏 恐怖'))
  assert.ok(!queries.includes('第三条不该出现'))
})

test('P0-3 种子补位：只补对得上情绪的，最多 4 首', () => {
  const cue = { tags: { energy: 'static', valence: 'dark' } }
  const seeds = [
    { song_id: 1, title: '安静的雨' },
    { song_id: 2, title: '黑暗降临' },
    { song_id: 3, title: '压抑的低音' },
    { song_id: 4, title: '无关内容' },
    { song_id: 5, title: '悲伤的夜' },
    { song_id: 6, title: '诡影' },
    { song_id: 7, title: '恐怖童谣' }
  ]
  const out = pickSeedTopping(seeds, cue)
  assert.equal(out.length, SEED_TOPPING.take)
  assert.ok(out.every((t) => t.song_id !== 1 && t.song_id !== 4), '没对上情绪词的不该被塞进来')
  assert.equal(pickSeedTopping([], cue).length, 0)
})

test('P1-6 SEARCH_WORDS 覆盖全部 56 个标签，且没有词表外的键', async () => {
  const raw = await fsp.readFile(new URL('../skills/bgm-prep/moods.json', import.meta.url), 'utf8')
  const { tags } = JSON.parse(raw)
  assert.equal(tags.length, 56)
  for (const tag of tags) assert.ok(SEARCH_WORDS[tag], `缺少标签 ${tag} 的中文检索词`)
  const allowed = new Set(tags)
  for (const key of Object.keys(SEARCH_WORDS)) assert.ok(allowed.has(key), `${key} 不在 56 词表里`)
})

test('P1-1 旧表的抓取分迁到 fetchScore，真实得分保留 score', () => {
  const sheet = normalizeSheet({
    scope: 'x',
    cues: [{
      scene: '走廊',
      candidates: [
        { song_id: 1, title: 'A', score: 8 },
        { song_id: 2, title: 'B', score: 0.76, analysis: { probs: { dark: 0.9 } } },
        { song_id: 3, title: 'C', fetchScore: 3, score: 0.5, analysis: { probs: { dark: 0.5 } } }
      ]
    }]
  }, 'x', null)
  const [a, b, c] = sheet.cues[0].candidates
  assert.equal(a.fetchScore, 8)
  assert.equal(a.score, undefined)
  assert.equal(b.score, 0.76)
  assert.equal(b.fetchScore, undefined)
  assert.equal(c.fetchScore, 3, '已有 fetchScore 时不再从 score 推断')
})

test('P1-2 bgm_view 的 full 表逐首列出候选与得分', () => {
  const sheet = {
    module: '测试',
    scope: 's1',
    cues: [{
      id: 'c01',
      scene: '走廊 · 涟漪门',
      trigger: '',
      need_bgm: true,
      state: 'ready',
      target: [{ tag: 'dark', weight: 1 }],
      candidates: [
        {
          song_id: 1, title: 'Caisson', artist: 'Loscil', duration: 469,
          score: 0.42, analysis: { probs: { dark: 0.8, calm: 0.1 } }, source: '太空氛围之声'
        }
      ],
      picks: null
    }]
  }
  const table = renderTable(sheet, { mode: 'full' })
  assert.match(table, /待选（候选 1）/)
  assert.match(table, /01 Caisson — Loscil/)
  // 得分是**按当前 target 实时算**的（target = dark 1.0，probs.dark = 0.8 → 0.80），
  // 不再读落盘的 0.42——那个是上一次 bgm_tag 的快照
  assert.match(table, /得分 0\.80/)
  assert.match(table, /出自《太空氛围之声》/)

  // 没分析时说明白，不留一个空分数
  sheet.cues[0].candidates[0].analysis = null
  sheet.cues[0].candidates[0].fetchScore = 3
  const raw = renderTable(sheet, { mode: 'full' })
  assert.match(raw, /得分 —/)
  assert.match(raw, /未分析（关键词分 3）/)
})

test('P2-1 跨 scope 合表：段序按数组顺序，review 按 scope 分节', () => {
  const cue = (id, scene) => ({
    id, scene, trigger: '', need_bgm: true, state: 'ready',
    target: [{ tag: 'dark', weight: 1 }], candidates: [], picks: null
  })
  const first = { module: 'M', session: 1, scope: 's1', cues: [cue('c01', '甲'), cue('c02', '乙')] }
  const second = { module: 'M', session: 1, scope: 's2', cues: [cue('c01', '丙')] }
  const merged = mergeSheets([first, second])
  assert.equal(merged.cues.length, 3)
  assert.deepEqual(merged.cues.map((c) => c.scene), ['甲', '乙', '丙'])
  assert.equal(merged.scope, 's1+s2')

  const review = renderCombinedReview([first, second])
  assert.match(review, /合并表/)
  assert.match(review, /## 1\. s1/)
  assert.match(review, /## 2\. s2/)
  assert.match(review, /共 2 份表 \/ 3 段/)
})

test('P2-2 bgm_verify：分析齐全时报正常，池子不对味时点名', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bgm-verify-'))
  const file = path.join(dir, 'bgm', 'v.cues.json')
  const tools = new Map()
  apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: {} })
  const exec = { agent: { session: { header: { cwd: dir } } } }
  assert.ok(tools.has('bgm_verify'), 'bgm_verify 应该已注册')

  const init = await tools.get('bgm_init').execute({
    file,
    module: '自检模组',
    scope: 'v',
    cues: [
      { scene: '走廊', need_bgm: true, target: [{ tag: 'dark', weight: 1 }] },
      { scene: '祭坛', need_bgm: true, target: [{ tag: 'dark', weight: 1 }] }
    ]
  }, exec)
  assert.equal(init.ok, true, JSON.stringify(init))

  const sheet = JSON.parse(await fsp.readFile(file, 'utf8'))
  sheet.cues[0].candidates = [
    { song_id: 1, title: '对味', artist: 'A', album: '', duration: 200, analysis: { probs: { dark: 0.9 } } },
    { song_id: 2, title: '次一点', artist: 'B', album: '', duration: 200, analysis: { probs: { dark: 0.6 } } },
    { song_id: 3, title: '也能用', artist: 'C', album: '', duration: 200, analysis: { probs: { dark: 0.5 } } }
  ]
  sheet.cues[1].candidates = [
    { song_id: 4, title: '儿歌', artist: 'D', album: '', duration: 200, analysis: { probs: { dark: 0.02 } } },
    { song_id: 5, title: '流行', artist: 'E', album: '', duration: 200, analysis: { probs: { dark: 0.03 } } },
    { song_id: 6, title: '圣诞', artist: 'F', album: '', duration: 200, analysis: { probs: { dark: 0.05 } } }
  ]
  await fsp.writeFile(file, JSON.stringify(sheet, null, 2), 'utf8')

  const verify = await tools.get('bgm_verify').execute({ file }, exec)
  assert.equal(verify.ok, true, JSON.stringify(verify))
  assert.match(verify.table, /已分析 6 首/)
  // 第 1 段正常，第 2 段池子不对味
  assert.equal(verify.poolIssues.length, 1)
  assert.match(verify.poolIssues[0], /^c02/)
  assert.equal(verify.tightIssues.length, 0, '池子不对的段不该再报权重过狠')

  // 少分析一首时应该点出来
  sheet.cues[0].candidates.push({ song_id: 7, title: '没分析', artist: 'G', album: '', duration: 200 })
  await fsp.writeFile(file, JSON.stringify(sheet, null, 2), 'utf8')
  const again = await tools.get('bgm_verify').execute({ file }, exec)
  assert.deepEqual(again.unanalyzed, ['c01'])
})

test('P2-1 bgm_commit files：两幕合成一个歌单，两边都记下 playlist_id', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bgm-commit-'))
  const tools = new Map()
  apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: {} })
  const exec = { agent: { session: { header: { cwd: dir } } } }
  const fileA = path.join(dir, 'bgm', 's1.cues.json')
  const fileB = path.join(dir, 'bgm', 's2.cues.json')

  for (const [file, scope, scene] of [[fileA, 's1', '第一幕 · 码头'], [fileB, 's2', '第二幕 · 机库']]) {
    const init = await tools.get('bgm_init').execute({
      file, module: '两幕测试', scope, cues: [{ scene, need_bgm: true }]
    }, exec)
    assert.equal(init.ok, true, JSON.stringify(init))
  }

  const sheetA = JSON.parse(await fsp.readFile(fileA, 'utf8'))
  sheetA.cues[0].candidates = [{ song_id: 11, encrypted_id: 'A'.repeat(32), title: '甲曲', artist: 'A', album: '', duration: 200 }]
  sheetA.cues[0].picks = { primary: { song_id: 11, why: '低频垫底' } }
  await fsp.writeFile(fileA, JSON.stringify(sheetA, null, 2), 'utf8')

  const sheetB = JSON.parse(await fsp.readFile(fileB, 'utf8'))
  sheetB.cues[0].candidates = [{ song_id: 22, encrypted_id: 'B'.repeat(32), title: '乙曲', artist: 'B', album: '', duration: 210 }]
  sheetB.cues[0].picks = { primary: { song_id: 22, why: '弦乐推进' } }
  await fsp.writeFile(fileB, JSON.stringify(sheetB, null, 2), 'utf8')

  const dry = await tools.get('bgm_commit').execute({ files: [fileA, fileB], dry_run: true }, exec)
  assert.equal(dry.ok, true, JSON.stringify(dry))
  assert.equal(dry.total, 2, '两幕的曲目都应算进同一个歌单')

  const committed = await tools.get('bgm_commit').execute({ files: [fileA, fileB] }, exec)
  assert.equal(committed.ok, true, JSON.stringify(committed))
  assert.equal(committed.total, 2)
  assert.ok(committed.playlistId)

  const afterA = JSON.parse(await fsp.readFile(fileA, 'utf8'))
  const afterB = JSON.parse(await fsp.readFile(fileB, 'utf8'))
  assert.equal(afterA.playlist_id, committed.playlistId, '第一幕记下歌单 id')
  assert.equal(afterB.playlist_id, committed.playlistId, '第二幕也要记下来，否则下次会再建一个')

  const review = await fsp.readFile(path.join(dir, 'bgm', 's1.review.md'), 'utf8')
  assert.match(review, /合并表/)
  assert.match(review, /## 1\. s1/)
  assert.match(review, /## 2\. s2/)
})

test('候选展示顺序：已分析按得分降序，未分析垫底', () => {
  const sheet = {
    module: '排序', scope: 'x', cues: [{
      id: 'c01', scene: '测试', trigger: '', need_bgm: true, state: 'ready',
      target: [{ tag: 'dark', weight: 1 }], picks: null,
      candidates: [
        { song_id: 1, title: '低分', artist: 'A', duration: 200, score: 0.12, analysis: { probs: { dark: 0.12 } } },
        { song_id: 2, title: '还没算', artist: 'B', duration: 200 },
        { song_id: 3, title: '高分', artist: 'C', duration: 200, score: 0.87, analysis: { probs: { dark: 0.87 } } }
      ]
    }]
  }
  const table = renderTable(sheet, { mode: 'full', candidateLimit: 3 })
  const order = ['高分', '低分', '还没算'].map((t) => table.indexOf(t))
  assert.ok(order[0] < order[1] && order[1] < order[2], `应按 高分 → 低分 → 未分析 排列，实际：${table}`)
  assert.match(table, /01 高分/, '编号跟着得分名次走')
})

test('改权重后不重算模型也能刷新得分（bgm_tag 无新歌时要重打分）', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bgm-rescore-'))
  const file = path.join(dir, 'bgm', 'r.cues.json')
  const tools = new Map()
  apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: {} })
  const exec = { agent: { session: { header: { cwd: dir } } } }

  await tools.get('bgm_init').execute({
    file, module: 'R', scope: 'r',
    cues: [{ scene: '走廊', need_bgm: true, target: [{ tag: 'dark', weight: 1 }] }]
  }, exec)

  const sheet = JSON.parse(await fsp.readFile(file, 'utf8'))
  sheet.cues[0].candidates = [
    { song_id: 1, title: '甲', artist: 'A', album: '', duration: 200, analysis: { probs: { dark: 0.6, happy: 0.9 }, vocal: 0.05 } },
    { song_id: 2, title: '乙', artist: 'B', album: '', duration: 200, analysis: { probs: { dark: 0.5 }, vocal: 0.05 } }
  ]
  await fsp.writeFile(file, JSON.stringify(sheet, null, 2), 'utf8')

  // 第一次：全部已分析 → 不会跑模型，但应当把得分写进去
  const run = await tools.get('bgm_tag').execute({ file }, exec)
  assert.equal(run.ok, true, JSON.stringify(run))
  assert.equal(run.tried, 0, '不该再跑模型')
  assert.equal(run.scored, 2, '仍要按当前权重重算得分')

  const after = JSON.parse(await fsp.readFile(file, 'utf8'))
  assert.ok(Number.isFinite(after.cues[0].candidates[0].score), '得分应写回文件')
  assert.ok(after.cues[0].candidates[0].score > 0)
})

// ---------------------------------------------------------------- 0.18 新增行为的断言

test('NOISE：type beat / 变速版 / 夜核不该进池', async () => {
  const { isNoise } = await import('../lib/filter.js')
  for (const title of [
    'Free Sad UK Garage Type Beat - "Ghost of you" pt.2',
    'NAVxPostMaloneTypeBeat-Leaving',
    'Shootout (Sped Up)',
    'Nightcore - Angel',
    'X (Slowed + Reverb)',
    'Y - Karaoke Version'
  ]) assert.ok(isNoise(title), `应被过滤：${title}`)
  for (const title of ['Death Waltz', 'Caisson', 'Seaside Retreat', '静心']) {
    assert.ok(!isNoise(title), `不该被过滤：${title}`)
  }
})

test('playFlag=false 不再当硬信号；版权下架 / 试听限制才过滤', async () => {
  const { normalizeTrack } = await import('../lib/filter.js')
  const base = { originalId: 1, id: 'A'.repeat(32), name: '普通曲目', duration: 200000, artists: [{ name: 'X' }] }
  assert.ok(normalizeTrack({ ...base, playFlag: false }), 'playFlag=false 应保留（实测大面积误杀 76% 池子）')
  assert.equal(normalizeTrack({ ...base, noCopyrightRcmd: { typeName: '无版权' } }), null)
  assert.equal(normalizeTrack({ ...base, freeTrialPrivilege: { cannotListenReason: 1 } }), null)
  assert.equal(normalizeTrack({ ...base, privilege: { st: -200 } }), null)
})

test('缓存键带音质与裁剪长度：换口径就换键', async () => {
  const { cacheKeyOf } = await import('../lib/analyze.js')
  const a = cacheKeyOf({ version: 'v1', quality: 'high', clipSeconds: 120 })
  const b = cacheKeyOf({ version: 'v1', quality: 'standard', clipSeconds: 120 })
  const c = cacheKeyOf({ version: 'v1', quality: 'high', clipSeconds: 0 })
  assert.equal(a, 'v1-qhigh-c120')
  assert.notEqual(a, b, '音质不同应当换键')
  assert.notEqual(a, c, '裁剪长度不同应当换键')
})

test('探针模式：每段只分析前 3 首并返回池子匹配度', async () => {
  const home = process.env.DSH_HOME
  const fake = fileURLToPath(new URL('./fixtures/fake-analyze.mjs', import.meta.url))
  const codeDir = path.join(home, 'code')
  const modelsDir = path.join(home, 'models')
  await fsp.mkdir(codeDir, { recursive: true })
  await fsp.mkdir(modelsDir, { recursive: true })
  await fsp.mkdir(path.join(home, 'bgm-prep'), { recursive: true })
  await fsp.writeFile(path.join(home, 'bgm-prep', 'settings.json'), JSON.stringify({
    analysis: {
      engine: 'music2emo', python: process.execPath, script: fake,
      code: codeDir, models: modelsDir, version: 'test-v1',
      perSongTimeoutMs: 8000, totalBudgetMs: 60000, batchSize: 8, threads: 2,
      vocal: { enabled: false }
    }
  }, null, 2), 'utf8')

  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bgm-probe-'))
  const file = path.join(dir, 'bgm', 'p.cues.json')
  const tools = new Map()
  apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: {} })
  const exec = { agent: { session: { header: { cwd: dir } } } }

  await tools.get('bgm_init').execute({
    file, module: '探针', scope: 'p',
    cues: [
      { scene: '甲段', need_bgm: true, target: [{ tag: 'dark', weight: 1 }] },
      { scene: '乙段', need_bgm: true, target: [{ tag: 'dark', weight: 1 }] }
    ]
  }, exec)

  const sheet = JSON.parse(await fsp.readFile(file, 'utf8'))
  sheet.cues[0].candidates = Array.from({ length: 6 }, (_, i) => ({ song_id: 7000 + i, title: `甲-${i}`, artist: 'A', album: '', duration: 200 }))
  sheet.cues[1].candidates = Array.from({ length: 6 }, (_, i) => ({ song_id: 7100 + i, title: `乙-${i}`, artist: 'B', album: '', duration: 200 }))
  await fsp.writeFile(file, JSON.stringify(sheet, null, 2), 'utf8')

  const run = await tools.get('bgm_tag').execute({ file, probe: true }, exec)
  assert.equal(run.ok, true, JSON.stringify(run))
  assert.equal(run.tried, 6, '两段各只看 3 首')
  assert.equal(run.probes.length, 2)
  for (const p of run.probes) {
    assert.equal(p.analyzed, 3)
    assert.ok(p.poolMatch > 0, '应给出池子匹配度')
  }
  assert.equal(typeof run.durationMs, 'number', '每个工具都应返回 durationMs')
})

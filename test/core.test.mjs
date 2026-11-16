import assert from 'node:assert/strict'
import test from 'node:test'
import { extractPlaylists, extractTracks } from '../lib/search.js'
import { isNoise, normalizeTrack, prepareCandidates } from '../lib/filter.js'
import { cueStatus, summarize, validateCueInputs } from '../lib/store.js'
import { mmss, renderTable, tagLine } from '../lib/format.js'

test('normalizeTrack 吃网易云歌单的典型形状', () => {
  const t = normalizeTrack({ id: 123, name: 'Dungeon', ar: [{ name: 'A' }, { name: 'B' }], al: { name: 'OST' }, dt: 245000 })
  assert.equal(t.song_id, 123)
  assert.equal(t.title, 'Dungeon')
  assert.equal(t.artist, 'A / B')
  assert.equal(t.album, 'OST')
  assert.equal(t.duration, 245)
})

test('normalizeTrack 吃开放平台可能的扁平形状', () => {
  const t = normalizeTrack({ songId: 9, songName: 'Nebula', artistName: 'C', albumName: 'D', duration: 180 })
  assert.deepEqual({ ...t }, { song_id: 9, title: 'Nebula', artist: 'C', album: 'D', duration: 180 })
})

test('normalizeTrack 拒绝没有 id 的条目', () => {
  assert.equal(normalizeTrack({ name: 'x' }), null)
  assert.equal(normalizeTrack(null), null)
})

test('版本污染能被识别', () => {
  for (const bad of ['晴天 (Live)', '演员 翻唱', 'Numb (Cover)', 'xx Remix', '伴奏版', '30秒试听片段', '某歌 DJ版']) {
    assert.equal(isNoise(bad), true, bad)
  }
  for (const good of ['Dungeon Ambience', 'Мрак', 'Apocalypse', 'The Cellar']) {
    assert.equal(isNoise(good), false, good)
  }
})

test('prepareCandidates 去重、过滤、限流', () => {
  const raw = [
    { id: 1, name: 'A', ar: [{ name: 'x' }], dt: 200000 },
    { id: 1, name: 'A dup', ar: [{ name: 'x' }], dt: 200000 },
    { id: 2, name: 'B (Live)', ar: [{ name: 'x' }], dt: 200000 },
    { id: 3, name: 'C', ar: [{ name: 'x' }], dt: 10000 },
    { id: 4, name: 'D 原声 OST', ar: [{ name: 'x' }], dt: 200000 }
  ]
  const out = prepareCandidates(raw, { limit: 5 })
  assert.equal(out.length, 2)
  assert.deepEqual(out.map((t) => t.song_id).sort(), [1, 4])
})

test('directives 的排除项会压分', () => {
  const raw = [
    { id: 1, name: 'Piano Sadness', ar: [{ name: 'x' }], dt: 200000 },
    { id: 2, name: 'Drone Doom', ar: [{ name: 'x' }], dt: 200000 }
  ]
  const out = prepareCandidates(raw, { directives: [{ text: '少用钢琴', effect: { exclude_texture: ['piano'] } }] })
  assert.equal(out[0].song_id, 2)
})

test('extractTracks 能从嵌套返回里挖出曲目', () => {
  const data = { code: 200, data: { playlist: { tracks: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] } } }
  assert.equal(extractTracks(data).length, 2)
})

test('extractPlaylists 能从搜索结果里挖出歌单', () => {
  const data = { data: { playlists: [{ id: 77, name: '跑团 BGM', trackCount: 30 }, { id: 0, name: 'bad' }] } }
  const out = extractPlaylists(data)
  assert.equal(out.length, 1)
  assert.equal(out[0].id, '77')
})

test('cueStatus 是派生的', () => {
  assert.equal(cueStatus({ need_bgm: false }), 'skipped')
  assert.equal(cueStatus({ need_bgm: true, candidates: [], picks: null }), 'ready')
  assert.equal(cueStatus({ need_bgm: true, candidates: [{ song_id: 1 }], picks: null }), 'candidates')
  assert.equal(cueStatus({ need_bgm: true, candidates: [{ song_id: 1 }], picks: { primary: { song_id: 1 } } }), 'picked')
})

test('validateCueInputs 抓住缺 scene 与重复 id', () => {
  assert.equal(validateCueInputs([{ scene: 'a' }, { scene: 'b' }]).ok, true)
  assert.equal(validateCueInputs([{ scene: '' }]).ok, false)
  assert.equal(validateCueInputs([{ id: 'c1', scene: 'a' }, { id: 'c1', scene: 'b' }]).ok, false)
})

test('summarize 计数正确', () => {
  const sheet = { cues: [
    { need_bgm: false, candidates: [], picks: null },
    { need_bgm: true, candidates: [{ song_id: 1 }], picks: { primary: { song_id: 1 } } },
    { need_bgm: true, candidates: [], picks: null }
  ] }
  const s = summarize(sheet)
  assert.equal(s.total, 3)
  assert.equal(s.skipped, 1)
  assert.equal(s.picked, 1)
  assert.equal(s.ready, 1)
})

test('mmss 与 tagLine', () => {
  assert.equal(mmss(245), '4:05')
  assert.equal(mmss(0), '')
  assert.equal(tagLine({ valence: 'dark', energy: 'static', texture: ['drone'], vocal: 'none' }), '[暗 / 静态 / drone / 无人声]')
})

test('表里用「第 k 段」，且不出现 c0x', () => {
  const sheet = {
    module: '测试模组', session: 3, scope: 'act3', directives: [],
    cues: [
      { id: 'c01', scene: '地窖', trigger: '走下去', need_bgm: true, state: 'ready', tags: { valence: 'dark' }, candidates: [], picks: null, rejected: [] },
      { id: 'c02', scene: '档案室', trigger: '', need_bgm: false, state: 'skipped', tags: null, candidates: [], picks: null, rejected: [] }
    ]
  }
  const l1 = renderTable(sheet, { mode: 'cues' })
  assert.match(l1, /第 1 段/)
  assert.match(l1, /第 2 段/)
  assert.doesNotMatch(l1, /c01/)
  assert.match(l1, /不配乐/)
})


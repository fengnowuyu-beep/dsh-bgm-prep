import { apply } from '../lib/index.js'
import { renderPlaylistCsv, renderPlaylistText, renderReview } from '../lib/format.js'
import { readSheet, sheetPaths, writeSheet } from '../lib/store.js'
import { atomicWrite } from '../lib/ncm.js'
const tools = new Map()
apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: { info() {}, warn() {} } })
const exec = { agent: { session: { header: { cwd: process.cwd() } } } }
const file = 'F:/Data/听枫馆/模组/COC/080天体之音/bgm/tianti.cues.json'

// 先把「燃烧」写进候选池（要落盘，pick 工具会重新读文件）
let sheet = await readSheet(file)
const cue = sheet.cues.find(c => c.id === 'c10')
const known = { song_id: 3461580283, title: '燃烧', artist: '$AMCHI', album: '燃烧', duration: 302,
  auto: { top: [['律动', 0.945], ['轻快', 0.032]], vocal: 0.919, margin: 0.913 } }
if (!cue.candidates.some(c => Number(c.song_id) === known.song_id)) cue.candidates.unshift(known)
cue.picks = null
await writeSheet(file, sheet)

const r = await tools.get('bgm_pick').execute({ file, picks: [{
  cue_id: 'c10',
  primary: { song_id: known.song_id, why: '律动 0.95，跳舞的场面；代价是有人声' },
  alts: cue.candidates.filter(c => Number(c.song_id) !== known.song_id).slice(0, 2).map(c => ({ song_id: c.song_id, why: c.title.slice(0, 20) }))
}] }, exec)
console.log('repick c10:', r.ok, r.rejectedInputs ?? '')

const final = await readSheet(file)
const paths = sheetPaths(file)
await atomicWrite(paths.review, renderReview(final))
await atomicWrite(paths.text, renderPlaylistText(final))
await atomicWrite(paths.csv, renderPlaylistCsv(final))
console.log('c10:', JSON.stringify(final.cues.find(c => c.id === 'c10').picks.primary))
console.log('曲目数:', (await (await import('node:fs/promises')).readFile(paths.text, 'utf8')).trim().split('\n').length)

import { apply } from '../lib/index.js'
import { renderPlaylistCsv, renderPlaylistText, renderReview } from '../lib/format.js'
import { readSheet, sheetPaths } from '../lib/store.js'
import { atomicWrite } from '../lib/ncm.js'
const tools = new Map()
apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: { info() {}, warn() {} } })
const exec = { agent: { session: { header: { cwd: process.cwd() } } } }
const file = 'F:/Data/听枫馆/模组/COC/080天体之音/bgm/tianti.cues.json'
const sheet = await readSheet(file)
const cue = sheet.cues.find(c => c.id === 'c11')
const hit = cue.candidates.find(c => c.title === 'Blackbird')
const alts = cue.candidates.filter(c => c.status !== 'x').filter(c => c.song_id !== hit.song_id).slice(0, 2)
const r = await tools.get('bgm_pick').execute({ file, picks: [{
  cue_id: 'c11',
  primary: { song_id: hit.song_id, why: '自动标签 紧张悬疑 0.48 · 人声 0.06' },
  alts: alts.map(a => ({ song_id: a.song_id, why: a.title.slice(0, 20) }))
}] }, exec)
console.log('pick:', r.ok, r.rejectedInputs ?? '')
const final = await readSheet(file)
const paths = sheetPaths(file)
await atomicWrite(paths.review, renderReview(final))
await atomicWrite(paths.text, renderPlaylistText(final))
await atomicWrite(paths.csv, renderPlaylistCsv(final))
console.log(renderReview(final).split('\n').slice(-30).join('\n'))

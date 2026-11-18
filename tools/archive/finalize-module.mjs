import { apply } from '../lib/index.js'
import { renderPlaylistCsv, renderPlaylistText, renderReview } from '../lib/format.js'
import { readSheet, sheetPaths } from '../lib/store.js'
import { atomicWrite } from '../lib/ncm.js'
import fs from 'node:fs/promises'

const tools = new Map()
apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: {} })
const exec = { agent: { session: { header: { cwd: process.cwd() } } } }
const file = 'F:/Data/听枫馆/模组/COC/018通向庭院之歌/bgm/tongxiang.cues.json'

await tools.get('bgm_init').execute({
  file, module: '通向庭院之歌', session: 1, scope: 'tongxiang', mode: 'patch',
  cues: [
    { id: 'c07', scene: '希望教会 · 祈祷会', wants: ['格里高利圣咏'] },
    { id: 'c13', scene: '逃离', wants: ['追逐 紧张 纯音乐'] }
  ]
}, exec)
const r = await tools.get('bgm_fetch').execute({ file, cue_ids: ['c07', 'c13'], force: true }, exec)
console.log('refetch:', r.filled, r.quotaUsed)

const sheet = await readSheet(file)
const used = new Set()
const picks = []
for (const cue of sheet.cues) {
  if (!cue.need_bgm || cue.candidates.length === 0) continue
  const top = cue.candidates.find((c) => !used.has(c.song_id)) ?? cue.candidates[0]
  used.add(top.song_id)
  picks.push({
    cue_id: cue.id,
    primary: { song_id: top.song_id, why: `${top.album || '器乐'}｜${top.title}`.slice(0, 30) },
    alts: cue.candidates.filter((c) => c.song_id !== top.song_id).slice(0, 2).map((c) => ({ song_id: c.song_id, why: c.title.slice(0, 16) }))
  })
}
const picked = await tools.get('bgm_pick').execute({ file, picks }, exec)
console.log('pick:', picked.ok, 'accepted=', picked.accepted)
if (!picked.ok) console.log(picked.rejectedInputs)
if (picked.hints?.length) console.log('hints:', picked.hints)

const final = await readSheet(file)
const paths = sheetPaths(file)
await atomicWrite(paths.review, renderReview(final))
await atomicWrite(paths.text, renderPlaylistText(final))
await atomicWrite(paths.csv, renderPlaylistCsv(final))
console.log('产物:', paths.review)

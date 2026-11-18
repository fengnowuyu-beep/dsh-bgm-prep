import { apply } from '../lib/index.js'
import { renderPlaylistCsv, renderPlaylistText, renderReview } from '../lib/format.js'
import { readSheet, sheetPaths } from '../lib/store.js'
import { atomicWrite } from '../lib/ncm.js'
import fs from 'node:fs/promises'

const tools = new Map()
apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: {} })
const exec = { agent: { session: { header: { cwd: process.cwd() } } } }
const file = 'F:/Data/听枫馆/模组/COC/080天体之音/bgm/tianti.cues.json'

// 逐段人工定选：按标题片段匹配候选
const choice = {
  c01: ['暗流', '暴风雨前的低空，标题就是暗流'],
  c02: ['Dark Corners', '低频铺底，标题直指洛夫克拉夫特'],
  c03: ['New Home', 'Vampyr 的钢琴，空屋子的味道'],
  c04: ['Almost Like Being in Love', '爵士三重奏，正好压住点唱机'],
  c05: ['Star Sky - Instrumental', '慢起、辽阔，天线转向的尺度'],
  c06: ['Death Waltz', '独奏大提琴的怪诞圆舞，最接近那段歌'],
  c07: ['误入怪物小镇', '恐怖滤波，密度高，像虫群'],
  c09: ['Oceans of Time', '宇宙尺度低鸣，地动的压迫感'],
  c10: ['燃烧', '标题和场景同义，火与暴乱'],
  c11: ['病变', '电子压迫，倒计时质感'],
  c12: ['These Memories', '空心吉他，余烬和回忆']
}

const sheet = await readSheet(file)
const picks = []
for (const [cueId, [needle, why]] of Object.entries(choice)) {
  const cue = sheet.cues.find((c) => c.id === cueId)
  if (!cue) continue
  const hit = cue.candidates.find((c) => c.title.includes(needle))
  if (!hit) { console.log(`MISS ${cueId} ${needle}`); continue }
  const alts = cue.candidates.filter((c) => c.song_id !== hit.song_id).slice(0, 2)
  picks.push({ cue_id: cueId, primary: { song_id: hit.song_id, why }, alts: alts.map((c) => ({ song_id: c.song_id, why: c.title.slice(0, 20) })) })
}
const r = await tools.get('bgm_pick').execute({ file, picks }, exec)
console.log('pick:', r.ok, 'accepted=', r.accepted, r.rejectedInputs ?? '')
if (r.hints?.length) console.log('hints:', r.hints)

const final = await readSheet(file)
const paths = sheetPaths(file)
await atomicWrite(paths.review, renderReview(final))
await atomicWrite(paths.text, renderPlaylistText(final))
await atomicWrite(paths.csv, renderPlaylistCsv(final))
console.log('\n' + renderReview(final))

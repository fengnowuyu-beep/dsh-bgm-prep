import { apply } from '../lib/index.js'
import { cuePrompts } from '../lib/match.js'
import { readSheet } from '../lib/store.js'
const tools = new Map()
apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: { info() {}, warn() {} } })
const exec = { agent: { session: { header: { cwd: process.cwd() } } } }
const file = 'F:/Data/听枫馆/模组/COC/026黑水溪/bgm/heishuixi.cues.json'

const sheet0 = await readSheet(file)
const empty = sheet0.cues.filter(c => c.need_bgm && (c.candidates?.length ?? 0) === 0).map(c => c.id)
console.log('待补:', empty.join(', ') || '(无)')
if (empty.length) {
  const r = await tools.get('bgm_fetch').execute({ file, cue_ids: empty }, exec)
  console.log('补取:', r.filled, '| 调用:', r.quotaUsed, r.errors?.length ? `| 错误 ${r.errors.length}` : '')
}

const sheet = await readSheet(file)
for (const cue of sheet.cues) {
  if (!cue.need_bgm) continue
  if ((cue.candidates?.length ?? 0) === 0) { console.log(`\n${cue.scene} —— 仍无候选`); continue }
  if (!['c10','c11','c12','c13'].includes(cue.id)) continue
  console.log(`\n${cue.scene}  [期望: ${cuePrompts(cue).map(p=>p.label).join('/')}]`)
  for (const c of cue.candidates.slice(0, 5)) console.log(`   ${c.title} — ${c.artist}`)
}

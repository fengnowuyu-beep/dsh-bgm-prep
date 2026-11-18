import { apply } from '../lib/index.js'
import { readSheet } from '../lib/store.js'
const tools = new Map()
apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: { info() {}, warn() {} } })
const exec = { agent: { session: { header: { cwd: process.cwd() } } } }
const file = 'F:/Data/听枫馆/模组/COC/026黑水溪/bgm/heishuixi.cues.json'
const r = await tools.get('bgm_tag').execute({ file, per_cue: 20, force: true }, exec)
console.log('tag:', JSON.stringify(r))
const sheet = await readSheet(file)
let total = 0, untagged = 0
for (const cue of sheet.cues) {
  if (!cue.need_bgm) continue
  for (const c of cue.candidates ?? []) { total++; if (!c.auto) untagged++ }
}
console.log(`候选 ${total} 首，未打标 ${untagged} 首`)

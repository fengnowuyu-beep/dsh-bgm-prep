import { apply } from '../lib/index.js'
import { cuePrompts } from '../lib/match.js'
import { readSheet } from '../lib/store.js'
const tools = new Map()
apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: { info() {}, warn() {} } })
const exec = { agent: { session: { header: { cwd: process.cwd() } } } }
const file = 'F:/Data/听枫馆/模组/COC/026黑水溪/bgm/heishuixi.cues.json'
const sheet0 = await readSheet(file)
for (const id of ['c02','c10','c11']) {
  const cue = sheet0.cues.find(c => c.id === id)
  console.log(`${id} 期望: ${cuePrompts(cue).map(p=>p.label).join(' / ')}`)
}
const r = await tools.get('bgm_tag').execute({ file, force: true, per_cue: 6 }, exec)
console.log('全表重打标:', JSON.stringify(r))

const sheet = await readSheet(file)
for (const cue of sheet.cues) {
  if (!cue.need_bgm) continue
  const sorted = [...cue.candidates].sort((a,b) => (b.auto?.match ?? -1) - (a.auto?.match ?? -1))
  const top = sorted.slice(0, 2).map(c => `[${Number(c.auto?.match ?? 0).toFixed(2)}] ${c.title}（${c.auto?.top?.[0]?.[0] ?? '?'}·人声${c.auto?.vocal ?? '?'}）`).join('  |  ')
  console.log(`${cue.id} ${cue.scene}: ${top}`)
}

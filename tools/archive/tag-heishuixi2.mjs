import { apply } from '../lib/index.js'
import { readSheet } from '../lib/store.js'
const tools = new Map()
apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: { info() {}, warn() {} } })
const exec = { agent: { session: { header: { cwd: process.cwd() } } } }
const file = 'F:/Data/听枫馆/模组/COC/026黑水溪/bgm/heishuixi.cues.json'
const t0 = Date.now()
const r = await tools.get('bgm_tag').execute({ file, per_cue: 6, force: true }, exec)
console.log('tag:', JSON.stringify(r), `| ${((Date.now()-t0)/1000).toFixed(0)}s`)

const sheet = await readSheet(file)
for (const cue of sheet.cues) {
  if (!cue.need_bgm) { console.log(`\n■ ${cue.scene} —— 不配乐`); continue }
  const sorted = [...(cue.candidates ?? [])].sort((a,b) => (b.auto?.match ?? -1) - (a.auto?.match ?? -1))
  console.log(`\n■ ${cue.scene}`)
  for (const c of sorted.slice(0, 3)) {
    const a = c.auto || {}
    const m = Number.isFinite(a.match) ? Number(a.match).toFixed(2) : ' - '
    console.log(`   [${m}] ${c.title} — ${c.artist}  | ${a.top?.[0]?.[0] ?? '?'} | 人声 ${a.vocal ?? '?'}`)
  }
}

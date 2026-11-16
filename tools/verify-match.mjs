import { apply } from '../lib/index.js'
import { cuePrompts } from '../lib/match.js'
import { readSheet } from '../lib/store.js'
const tools = new Map()
apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: { info() {}, warn() {} } })
const exec = { agent: { session: { header: { cwd: process.cwd() } } } }
const file = 'F:/Data/听枫馆/模组/COC/080天体之音/bgm/tianti.cues.json'

const sheet0 = await readSheet(file)
for (const id of ['c06', 'c11']) {
  const cue = sheet0.cues.find(c => c.id === id)
  console.log(`${id} ${cue.scene} → 期望词: ${cuePrompts(cue).map(p => p.label).join(' / ')}`)
}

const t0 = Date.now()
const r = await tools.get('bgm_tag').execute({ file, cue_ids: ['c06', 'c11'], per_cue: 4, force: true }, exec)
console.log('tag:', JSON.stringify(r), `(${((Date.now()-t0)/1000).toFixed(0)}s)`)

const sheet = await readSheet(file)
for (const id of ['c06', 'c11']) {
  const cue = sheet.cues.find(c => c.id === id)
  console.log(`\n=== ${cue.scene} ===`)
  const sorted = [...cue.candidates].sort((a,b) => (b.auto?.match ?? -1) - (a.auto?.match ?? -1))
  for (const c of sorted.slice(0, 6)) {
    const a = c.auto || {}
    console.log(`  匹配 ${String(a.match ?? '-').padEnd(5)} ${String(a.matchLabel ?? '').padEnd(8)} | ${c.title} | 像: ${a.top?.[0]?.[0] ?? '-'} ${a.top?.[0]?.[1] ?? ''} | 人声 ${a.vocal ?? '-'}`)
  }
}

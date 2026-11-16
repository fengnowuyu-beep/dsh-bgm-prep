import { apply } from '../lib/index.js'
import { Workbench } from '../lib/ui.js'
const tools = new Map()
apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: { info() {}, warn() {} } })
const wb = new Workbench({ getTools: () => tools, logger: {} })
const snap = await wb.snapshot('F:/Data/听枫馆/模组/COC/080天体之音/bgm/tianti.cues.json')
console.log('stats:', JSON.stringify(snap.stats))
const cue = snap.cues.find(c => c.id === 'c11')
console.log('c11:', cue.scene)
for (const c of cue.candidates.slice(0, 3)) console.log('  -', c.title, '| auto:', JSON.stringify(c.auto), '| hint:', c.hint)

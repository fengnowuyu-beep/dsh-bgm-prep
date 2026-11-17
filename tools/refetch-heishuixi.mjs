import { apply } from '../lib/index.js'
import { readSheet } from '../lib/store.js'
const tools = new Map()
apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: { info() {}, warn() {} } })
const exec = { agent: { session: { header: { cwd: process.cwd() } } } }
const file = 'F:/Data/听枫馆/模组/COC/026黑水溪/bgm/heishuixi.cues.json'
const sheet = await readSheet(file)
const ids = sheet.cues.filter(c => c.need_bgm).map(c => c.id)
const r1 = await tools.get('bgm_fetch').execute({ file, cue_ids: ids.slice(0, 8), force: true }, exec)
console.log('第一轮:', r1.filled)
const r2 = await tools.get('bgm_fetch').execute({ file, cue_ids: ids.slice(8), force: true }, exec)
console.log('第二轮:', r2.filled)

const after = await readSheet(file)
const names = {}
let total = 0
for (const cue of after.cues) for (const c of cue.candidates ?? []) { names[c.title] = (names[c.title] ?? 0) + 1; total++ }
const dup = Object.entries(names).filter(([,n]) => n > 1).sort((a,b)=>b[1]-a[1])
console.log(`候选总数 ${total}，不同曲目 ${Object.keys(names).length}`)
console.log('仍重复:', dup.length === 0 ? '(无)' : dup.slice(0,6).map(([t,n]) => `${t}×${n}`).join('  '))

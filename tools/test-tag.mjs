import { apply } from '../lib/index.js'
import fs from 'node:fs/promises'
const tools = new Map()
apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: { info() {}, warn() {} } })
const exec = { agent: { session: { header: { cwd: process.cwd() } } } }
const file = 'F:/Data/听枫馆/模组/COC/080天体之音/bgm/tianti.cues.json'
const r = await tools.get('bgm_tag').execute({ file, cue_ids: ['c11'], per_cue: 3, force: true }, exec)
console.log('tool:', JSON.stringify(r))
const sheet = JSON.parse(await fs.readFile(file, 'utf8'))
const cue = sheet.cues.find(c => c.id === 'c11')
for (const c of cue.candidates.slice(0, 3)) {
  console.log(`- ${c.title} :: auto=${JSON.stringify(c.auto)}`)
}

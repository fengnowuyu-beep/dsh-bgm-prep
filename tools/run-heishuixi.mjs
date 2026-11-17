import { apply } from '../lib/index.js'
import { cuePrompts } from '../lib/match.js'
import { readSheet } from '../lib/store.js'
import fs from 'node:fs/promises'
const tools = new Map()
apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: { info() {}, warn() {} } })
const exec = { agent: { session: { header: { cwd: process.cwd() } } } }
const file = 'F:/Data/听枫馆/模组/COC/026黑水溪/bgm/heishuixi.cues.json'
const input = JSON.parse(await fs.readFile('E:/Data/Project/DeepSeekHarness/DSH-Homemade-Plugins/dsh-bgm-prep/examples/heishuixi.cues.input.json', 'utf8'))

const init = await tools.get('bgm_init').execute({
  file, module: '黑水溪', session: 1, scope: 'heishuixi', mode: 'replace', cues: input
}, exec)
console.log('init ok:', init.ok, init.error ?? '')
const t0 = Date.now()
const fetched = await tools.get('bgm_fetch').execute({ file }, exec)
console.log('fetch:', fetched.filled, '| 调用:', fetched.quotaUsed, `| ${((Date.now()-t0)/1000).toFixed(0)}s`)

const sheet = await readSheet(file)
for (const cue of sheet.cues) {
  if (!cue.need_bgm) { console.log(`\n${cue.scene} —— 不配乐`); continue }
  console.log(`\n${cue.scene}  [期望: ${cuePrompts(cue).map(p=>p.label).join('/')}]`)
  for (const c of cue.candidates.slice(0, 5)) console.log(`   ${c.title} — ${c.artist}`)
}

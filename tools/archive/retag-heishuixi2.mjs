import { apply } from '../lib/index.js'
const tools = new Map()
apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: { info() {}, warn() {} } })
const exec = { agent: { session: { header: { cwd: process.cwd() } } } }
const file = 'F:/Data/听枫馆/模组/COC/026黑水溪/bgm/heishuixi.cues.json'
const r = await tools.get('bgm_tag').execute({ file, per_cue: 6, force: true }, exec)
console.log('retag:', JSON.stringify(r))

import { apply } from '../lib/index.js'
import { readSheet } from '../lib/store.js'
const tools = new Map()
apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: { info() {}, warn() {} } })
const exec = { agent: { session: { header: { cwd: process.cwd() } } } }
const file = 'F:/Data/听枫馆/模组/COC/026黑水溪/bgm/heishuixi.cues.json'

await tools.get('bgm_init').execute({
  file, module: '黑水溪', session: 1, scope: 'heishuixi', mode: 'patch',
  cues: [{ id: 'c11', scene: '洞穴 · 大地子宫', wants: ['恐怖 地下 低沉 氛围'], tags: { tension: 10, valence: 'dark', energy: 'static', texture: ['drone'], vocal: 'none', min_len: 240 } }]
}, exec)
const r = await tools.get('bgm_fetch').execute({ file, cue_ids: ['c11'], force: true }, exec)
console.log('refetch c11:', r.filled, '| 调用:', r.quotaUsed)

const sheet = await readSheet(file)
const cue = sheet.cues.find(c => c.id === 'c11')
for (const c of cue.candidates) console.log(`   ${c.title} — ${c.artist}`)

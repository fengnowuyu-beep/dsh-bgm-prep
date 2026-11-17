import { apply } from '../lib/index.js'
import { readSheet } from '../lib/store.js'
import { loadVocabulary } from '../lib/vocabulary.js'
import { cueLabels } from '../lib/match.js'
const tools = new Map()
apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: { info() {}, warn() {} } })
const exec = { agent: { session: { header: { cwd: process.cwd() } } } }
const vocab = await loadVocabulary()
console.log('词表概念数:', vocab.length, '| 平均每概念句数:', (vocab.reduce((s,c)=>s+c.prompts.length,0)/vocab.length).toFixed(1))
const sheet0 = await readSheet('F:/Data/听枫馆/模组/COC/026黑水溪/bgm/heishuixi.cues.json')
console.log('示例期望词:', cueLabels(sheet0.cues[0]).join(' / '))
const file = 'F:/Data/听枫馆/模组/COC/026黑水溪/bgm/heishuixi.cues.json'
const t0 = Date.now()
const r = await tools.get('bgm_tag').execute({ file, per_cue: 20, force: true }, exec)
console.log('tag:', JSON.stringify(r), `| ${((Date.now()-t0)/60/1000).toFixed(1)} 分钟`)

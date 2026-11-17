import { apply } from '../lib/index.js'
import { readSheet } from '../lib/store.js'
const tools = new Map()
apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: { info() {}, warn() {} } })
const exec = { agent: { session: { header: { cwd: process.cwd() } } } }
const file = 'F:/Data/听枫馆/模组/COC/026黑水溪/bgm/heishuixi.cues.json'

const patches = [
  { id: 'c02', scene: '密斯卡托尼克山口 · 大地的心跳', wants: ['恐怖 氛围'] },
  { id: 'c10', scene: '母神赠礼发作 · 幻觉与身体', wants: ['恐怖 音效'] },
  { id: 'c11', scene: '洞穴 · 大地子宫', wants: ['暗黑 氛围'] }
]
await tools.get('bgm_init').execute({ file, module: '黑水溪', session: 1, scope: 'heishuixi', mode: 'patch', cues: patches }, exec)
const ids = patches.map(p => p.id)
const f = await tools.get('bgm_fetch').execute({ file, cue_ids: ids, force: true }, exec)
console.log('refetch:', f.filled, '| 调用:', f.quotaUsed)
const t = await tools.get('bgm_tag').execute({ file, cue_ids: ids, per_cue: 6, force: true }, exec)
console.log('tag:', JSON.stringify(t))

const sheet = await readSheet(file)
for (const id of ids) {
  const cue = sheet.cues.find(c => c.id === id)
  console.log(`\n■ ${cue.scene}`)
  const sorted = [...cue.candidates].sort((a,b) => (b.auto?.match ?? -1) - (a.auto?.match ?? -1))
  for (const c of sorted.slice(0, 4)) {
    const a = c.auto || {}
    console.log(`   [${Number(a.match ?? 0).toFixed(2)}] ${c.title} — ${c.artist} | ${a.top?.[0]?.[0] ?? '?'} | 人声 ${a.vocal ?? '?'}`)
  }
}

import { apply } from '../lib/index.js'
import fs from 'node:fs/promises'
const tools = new Map()
apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: { info() {}, warn() {} } })
const exec = { agent: { session: { header: { cwd: process.cwd() } } } }
const file = 'F:/Data/听枫馆/模组/COC/080天体之音/bgm/tianti.cues.json'

await tools.get('bgm_init').execute({
  file, module: '天体之音', session: 1, scope: 'tianti', mode: 'patch',
  cues: [
    { id: 'c10', scene: '海登之舞 · 全镇疯狂', wants: ['暴乱 混乱 黑暗 器乐'] },
    { id: 'c11', scene: '控制室 · 关闭天线', wants: ['悬疑 电子 紧张 器乐'] }
  ]
}, exec)
const f = await tools.get('bgm_fetch').execute({ file, cue_ids: ['c10','c11'], force: true }, exec)
console.log('fetch:', f.filled, f.quotaUsed)
const t = await tools.get('bgm_tag').execute({ file, cue_ids: ['c10','c11'], per_cue: 8, force: true }, exec)
console.log('tag:', JSON.stringify(t))

const sheet = JSON.parse(await fs.readFile(file, 'utf8'))
for (const id of ['c10','c11']) {
  const cue = sheet.cues.find(c => c.id === id)
  console.log(`\n=== ${id} ${cue.scene} ===`)
  cue.candidates.forEach((c, i) => {
    const a = c.auto || {}
    const tag = a.top ? `${a.top[0][0]} ${a.top[0][1]}` : (a.error || '未打标')
    console.log(`  ${i+1}. ${c.title} — ${c.artist} | ${tag} | 人声 ${a.vocal ?? '-'} | 差 ${a.margin ?? '-'}`)
  })
}

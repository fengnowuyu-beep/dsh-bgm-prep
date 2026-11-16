import { apply } from '../lib/index.js'
import fs from 'node:fs/promises'
const tools = new Map()
apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: {} })
const exec = { agent: { session: { header: { cwd: process.cwd() } } } }
const file = 'F:/Data/听枫馆/模组/COC/080天体之音/bgm/tianti.cues.json'

await tools.get('bgm_init').execute({
  file, module: '天体之音', session: 1, scope: 'tianti', mode: 'patch',
  cues: [
    { id: 'c05', scene: 'GPCA · 天线场与观测塔', wants: ['科幻 太空 电子 辽阔'] },
    { id: 'c06', scene: '格赫罗斯的信号', wants: ['恐怖 低频 嗡鸣 不协和'] },
    { id: 'c07', scene: '事件 · 蝗灾与群鸦', wants: ['恐怖 悬疑 密集 不安'] }
  ]
}, exec)
const r = await tools.get('bgm_fetch').execute({ file, cue_ids: ['c05','c06','c07'], force: true }, exec)
console.log('refetch:', r.filled, r.quotaUsed)

const s = JSON.parse(await fs.readFile(file, 'utf8'))
for (const id of ['c05','c06','c07']) {
  const cue = s.cues.find(c => c.id === id)
  console.log(`\n${cue.scene}`)
  cue.candidates.forEach((c, i) => console.log(`  ${i+1}. ${c.title} — ${c.artist} （${c.album || '-'}）`))
}

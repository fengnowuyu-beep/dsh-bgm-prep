import { apply } from '../lib/index.js'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const tools = new Map()
apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: {} })
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bgm-real2-'))
const exec = { agent: { session: { header: { cwd: dir } } } }
const file = path.join(dir, 'bgm', 'xueyang.cues.json')
await tools.get('bgm_init').execute({
  file, module: '血阳', session: 1, scope: 'xueyang',
  cues: [
    { scene: '村庄 · 血月升起', need_bgm: true, tags: { tension: 6, valence: 'dark', energy: 'static', texture: ['drone'] } },
    { scene: '祭坛 · 对峙', need_bgm: true, tags: { tension: 8, valence: 'dark', energy: 'building', texture: ['strings'] } },
    { scene: '追逐 · 夜路', need_bgm: true, tags: { tension: 9, valence: 'dark', energy: 'driving', texture: ['percussion'] } }
  ]
}, exec)
const t0 = Date.now()
const r = await tools.get('bgm_fetch').execute({ file }, exec)
console.log('fetch:', JSON.stringify({ filled: r.filled, quota: r.quotaUsed }), ((Date.now()-t0)/1000).toFixed(1)+'s')
const sheet = JSON.parse(await fs.readFile(file, 'utf8'))
for (const cue of sheet.cues) {
  console.log(`\n【${cue.scene}】${cue.candidates.length} 首`)
  for (const c of cue.candidates.slice(0,4)) console.log(`  ${c.title} — ${c.artist}`)
}
console.log('\n文件:', file)

// 真实跑一遍：建表 → 检索候选 → 打印结果（不选曲、不写账号）
import { apply } from '../lib/index.js'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const tools = new Map()
apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: {} })
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bgm-real-'))
const exec = { agent: { session: { header: { cwd: dir } } } }
const file = path.join(dir, 'bgm', 'demo.cues.json')

const init = await tools.get('bgm_init').execute({
  file, module: '试跑模组', session: 1, scope: 'demo',
  cues: [
    { scene: '地窖 · 封蜡信', trigger: '玩家走下石阶，看见石桌上未拆的信', need_bgm: true, tags: { tension: 6, valence: 'dark', energy: 'static', texture: ['drone', 'strings'], vocal: 'none', min_len: 180 } },
    { scene: '档案室 · 翻卷宗', need_bgm: false },
    { scene: '码头 · 夜袭', trigger: '船靠岸时被伏击', need_bgm: true, tags: { tension: 8, valence: 'dark', energy: 'burst', texture: ['percussion'], vocal: 'none' } },
    { scene: '市政厅 · 审问', trigger: '调查员在众目下被质询', need_bgm: true, tags: { tension: 7, valence: 'neutral', energy: 'building', texture: ['strings'], vocal: 'none' } },
    { scene: '结局 · 站台', trigger: '雾里等一列不会来的火车', need_bgm: true, tags: { tension: 3, valence: 'dark', energy: 'static', texture: ['piano'], vocal: 'none' } }
  ]
}, exec)
console.log(init.table, '\n')

const t0 = Date.now()
const r = await tools.get('bgm_fetch').execute({ file }, exec)
console.log('fetch:', JSON.stringify({ filled: r.filled, insufficient: r.insufficient, errors: r.errors, quotaUsed: r.quotaUsed }), `${((Date.now() - t0) / 1000).toFixed(1)}s`)

const sheet = JSON.parse(await fs.readFile(file, 'utf8'))
for (const cue of sheet.cues) {
  if (!cue.need_bgm) continue
  console.log(`\n【${cue.scene}】 候选 ${cue.candidates.length}`)
  for (const c of cue.candidates) {
    console.log(`  ${String(c.song_id).padEnd(12)} ${c.title.slice(0, 34).padEnd(36)} ${String(c.artist).slice(0, 20).padEnd(22)} ${Math.floor(c.duration / 60)}:${String(c.duration % 60).padStart(2, '0')}`)
  }
}
console.log('\n文件:', file)

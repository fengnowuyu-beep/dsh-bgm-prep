// 用一段输入 JSON 跑「建表 + 检索」，打印候选清单供人工/agent 定选。
// 用法: node run-module.mjs <input.json> <out.cues.json> [module] [session] [scope]
import { apply } from '../lib/index.js'
import fs from 'node:fs/promises'

const [inputPath, outPath, module = '通向庭院之歌', session = '1', scope = 'tongxiang'] = process.argv.slice(2)
if (!inputPath || !outPath) {
  console.error('用法: node run-module.mjs <input.json> <out.cues.json>')
  process.exit(2)
}

const tools = new Map()
apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: {} })
const exec = { agent: { session: { header: { cwd: process.cwd() } } } }

const cues = JSON.parse(await fs.readFile(inputPath, 'utf8'))
await fs.rm(outPath, { force: true })

const init = await tools.get('bgm_init').execute({
  file: outPath, module, session: Number(session), scope, cues
}, exec)
console.log(init.table)
if (!init.ok) { console.error(init.error); process.exit(1) }

const t0 = Date.now()
let filled = 0
let quota = 0
let errors = []
let insufficient = []
for (let round = 0; round < 4; round += 1) {
  const fetched = await tools.get('bgm_fetch').execute({ file: outPath }, exec)
  filled += fetched.filled ?? 0
  quota += fetched.quotaUsed ?? 0
  errors = errors.concat(fetched.errors ?? [])
  insufficient = insufficient.concat(fetched.insufficient ?? [])
  if ((fetched.filled ?? 0) === 0) break
}
console.log(`\nfetch: filled=${filled} quota=${quota} ${((Date.now() - t0) / 1000).toFixed(1)}s`)
if (errors.length) console.log('errors:', errors)
if (insufficient.length) console.log('候选不足:', insufficient.join(','))

const sheet = JSON.parse(await fs.readFile(outPath, 'utf8'))
sheet.cues.forEach((cue, i) => {
  if (!cue.need_bgm) return
  console.log(`\n${i + 1}. ${cue.scene}  (${cue.candidates.length} 首)`)
  cue.candidates.forEach((c, j) => {
    const d = c.duration ? `${Math.floor(c.duration / 60)}:${String(c.duration % 60).padStart(2, '0')}` : '--'
    console.log(`   ${String(j + 1).padStart(2)}. [${c.song_id}] ${d.padStart(5)}  ${c.title} — ${c.artist}${c.album ? ` （${c.album}）` : ''}`)
  })
})
console.log('\n表:', outPath)


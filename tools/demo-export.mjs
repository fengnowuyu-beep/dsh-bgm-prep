// 生成一份完整的示例产物（review.md / playlist.txt / playlist.csv），不写账号。
import { apply } from '../lib/index.js'
import { renderPlaylistCsv, renderPlaylistText, renderReview } from '../lib/format.js'
import { readSheet, sheetPaths } from '../lib/store.js'
import { atomicWrite } from '../lib/ncm.js'
import fs from 'node:fs/promises'

const tools = new Map()
apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: {} })

const outDir = process.argv[2] ?? 'E:/Data/Project/DeepSeekHarness/DSH-Homemade-Plugins/dsh-bgm-prep/examples'
const exec = { agent: { session: { header: { cwd: outDir } } } }
const file = `${outDir}/blood-sun.cues.json`

await fs.mkdir(outDir, { recursive: true })
await fs.rm(file, { force: true })

const init = await tools.get('bgm_init').execute({
  file, module: '血阳', session: 1, scope: 'blood-sun',
  cues: [
    { scene: '村庄 · 血月升起', trigger: '红月照在打谷场上，狗不叫了', need_bgm: true, tags: { tension: 6, valence: 'dark', energy: 'static', texture: ['drone'], vocal: 'none', min_len: 180 } },
    { scene: '祠堂 · 牌位', trigger: '推开祠堂门，看见多出来的一块牌位', need_bgm: true, tags: { tension: 7, valence: 'dark', energy: 'static', texture: ['strings'], vocal: 'none', min_len: 180 } },
    { scene: '祭坛 · 对峙', trigger: '族长在祭坛前转过身，手里还端着那碗血', need_bgm: true, tags: { tension: 8, valence: 'dark', energy: 'building', texture: ['choir'], vocal: 'wordless', min_len: 240 } },
    { scene: '麦田 · 追逐', trigger: '火把在身后排成一线，越来越近', need_bgm: true, tags: { tension: 9, valence: 'dark', energy: 'driving', texture: ['percussion'], vocal: 'none', min_len: 180 } },
    { scene: '井边 · 收尾', trigger: '天亮了，井里只剩下水声', need_bgm: true, tags: { tension: 3, valence: 'neutral', energy: 'static', texture: ['piano'], vocal: 'none', min_len: 180 } },
    { scene: '回程 · 车马', trigger: '车队离开村子，没人回头', need_bgm: false }
  ]
}, exec)
console.log(init.table)

const t0 = Date.now()
const fetched = await tools.get('bgm_fetch').execute({ file }, exec)
console.log(`\nfetch: filled=${fetched.filled} quota=${fetched.quotaUsed} ${((Date.now() - t0) / 1000).toFixed(1)}s`)

const sheet = await readSheet(file)
const used = new Set()
const picks = []
for (const cue of sheet.cues) {
  if (!cue.need_bgm || cue.candidates.length === 0) continue
  const top = cue.candidates.find((c) => !used.has(c.song_id)) ?? cue.candidates[0]
  used.add(top.song_id)
  const alts = cue.candidates.filter((c) => c.song_id !== top.song_id).slice(0, 2)
  picks.push({
    cue_id: cue.id,
    primary: { song_id: top.song_id, why: `${top.album || '器乐'} · ${Math.floor(top.duration / 60)}分` },
    alts: alts.map((c) => ({ song_id: c.song_id, why: c.title.slice(0, 20) }))
  })
}
const picked = await tools.get('bgm_pick').execute({ file, picks }, exec)
console.log('pick:', picked.ok, 'accepted=', picked.accepted)
if (!picked.ok) console.log(picked.rejectedInputs)

const final = await readSheet(file)
const paths = sheetPaths(file)
await atomicWrite(paths.review, renderReview(final))
await atomicWrite(paths.text, renderPlaylistText(final))
await atomicWrite(paths.csv, renderPlaylistCsv(final))
console.log('\n产物：')
console.log(' ', paths.review)
console.log(' ', paths.text)
console.log(' ', paths.csv)


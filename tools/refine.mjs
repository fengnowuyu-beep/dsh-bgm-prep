import { apply } from '../lib/index.js'
const tools = new Map()
apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: {} })
const exec = { agent: { session: { header: { cwd: process.cwd() } } } }
const file = 'F:/Data/听枫馆/模组/COC/018通向庭院之歌/bgm/tongxiang.cues.json'

const patch = await tools.get('bgm_init').execute({
  file, module: '通向庭院之歌', session: 1, scope: 'tongxiang', mode: 'patch',
  cues: [
    { id: 'c07', scene: '希望教会 · 祈祷会', wants: ['圣歌 合唱 教堂 诡异'] },
    { id: 'c11', scene: '左边的门 · 阿撒托斯的宫殿', wants: ['宇宙 恐怖 氛围 史诗'] },
    { id: 'c13', scene: '逃离', wants: ['追逐 崩塌 混乱'] }
  ]
}, exec)
console.log('patch:', patch.ok, patch.error ?? '')

const r = await tools.get('bgm_fetch').execute({ file, cue_ids: ['c07', 'c11', 'c13'], force: true }, exec)
console.log('refetch:', JSON.stringify({ filled: r.filled, quota: r.quotaUsed, insuff: r.insufficient }))

import fs from 'node:fs/promises'
const sheet = JSON.parse(await fs.readFile(file, 'utf8'))
for (const id of ['c07', 'c11', 'c13']) {
  const cue = sheet.cues.find((c) => c.id === id)
  console.log(`\n${cue.scene}`)
  for (const c of cue.candidates.slice(0, 6)) console.log(`   ${c.title} — ${c.artist} （${c.album}）`)
}

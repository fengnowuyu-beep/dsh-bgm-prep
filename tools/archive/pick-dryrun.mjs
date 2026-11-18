// 在真实检索出的表上模拟 agent 定选，然后 dry_run 校验建歌单路径
import { apply } from '../lib/index.js'
import fs from 'node:fs/promises'

const file = process.argv[2]
if (!file) { console.error('用法: node pick-dryrun.mjs <cues.json>'); process.exit(2) }

const tools = new Map()
apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: {} })
const exec = { agent: { session: { header: { cwd: process.cwd() } } } }

const sheet = JSON.parse(await fs.readFile(file, 'utf8'))
const picks = []
for (const [i, cue] of sheet.cues.entries()) {
  if (!cue.need_bgm || cue.candidates.length === 0) continue
  const top = cue.candidates[0]
  picks.push({
    cue_id: cue.id,
    primary: { song_id: top.song_id, why: `${top.album || '器乐'}：${top.title.slice(0, 12)}` },
    alts: cue.candidates.slice(1, 3).map((c) => ({ song_id: c.song_id, why: c.title.slice(0, 12) }))
  })
}

const picked = await tools.get('bgm_pick').execute({ file, picks }, exec)
console.log('pick:', picked.ok, 'accepted=', picked.accepted, picked.rejectedInputs ?? '')

const dry = await tools.get('bgm_commit').execute({ file, dry_run: true }, exec)
console.log('\ndry_run:', JSON.stringify(dry, null, 2))

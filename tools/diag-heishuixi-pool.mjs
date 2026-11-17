import { readSheet } from '../lib/store.js'
const sheet = await readSheet('F:/Data/听枫馆/模组/COC/026黑水溪/bgm/heishuixi.cues.json')
const all = new Set(); const perCue = []
for (const cue of sheet.cues) {
  if (!cue.need_bgm) continue
  for (const c of cue.candidates ?? []) all.add(c.song_id)
  perCue.push(`${cue.id}:${(cue.candidates ?? []).length}`)
}
console.log('每段候选数:', perCue.join(' '))
console.log('去重后不同曲目:', all.size)
const names = {}
for (const cue of sheet.cues) for (const c of cue.candidates ?? []) names[c.title] = (names[c.title] ?? 0) + 1
const top = Object.entries(names).sort((a,b)=>b[1]-a[1]).slice(0,8)
console.log('重复最多的:', top.map(([t,n]) => `${t}×${n}`).join('  '))

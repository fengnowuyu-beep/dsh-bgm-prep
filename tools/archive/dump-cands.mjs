import fs from 'node:fs/promises'
const file = 'F:/Data/听枫馆/模组/COC/018通向庭院之歌/bgm/tongxiang.cues.json'
const s = JSON.parse(await fs.readFile(file, 'utf8'))
for (const c of s.cues) {
  if (!c.need_bgm) continue
  console.log(`\n## ${c.id} ${c.scene}`)
  c.candidates.forEach((t, i) => {
    const d = t.duration ? `${Math.floor(t.duration/60)}:${String(t.duration%60).padStart(2,'0')}` : '--'
    console.log(`  ${i+1}. [${t.song_id}] ${d}  ${t.title} — ${t.artist} / ${t.album}`)
  })
}

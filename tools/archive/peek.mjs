import fs from 'node:fs/promises'
const f = 'F:/Data/听枫馆/模组/COC/018通向庭院之歌/bgm/tongxiang.cues.json'
const s = JSON.parse(await fs.readFile(f, 'utf8'))
for (const c of s.cues) {
  console.log(`${c.id} ${c.scene} | state=${c.state} cand=${c.candidates.length} | note=${c.note || '-'}`)
}

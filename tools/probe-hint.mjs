import fs from 'node:fs/promises'
import { explainCandidate } from '../lib/format.js'
const s = JSON.parse(await fs.readFile('F:/Data/听枫馆/模组/COC/018通向庭院之歌/bgm/tongxiang.cues.json','utf8'))
for (const cue of s.cues.filter(c => c.need_bgm).slice(0, 3)) {
  console.log(`\n${cue.scene}`)
  for (const c of cue.candidates.slice(0, 3)) console.log('  • ' + explainCandidate(c, cue))
}

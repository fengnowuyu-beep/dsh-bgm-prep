import { apply } from '../lib/index.js'
import { renderPlaylistCsv, renderPlaylistText, renderReview } from '../lib/format.js'
import { readSheet, sheetPaths } from '../lib/store.js'
import { atomicWrite } from '../lib/ncm.js'
import fs from 'node:fs/promises'

const tools = new Map()
apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: {} })
const exec = { agent: { session: { header: { cwd: process.cwd() } } } }
const file = 'F:/Data/听枫馆/模组/COC/018通向庭院之歌/bgm/tongxiang.cues.json'

const picks = [
  { cue_id: 'c01', primary: { song_id: 1935704983, why: '1920年代舞曲，铜管轻但不吵' }, alts: [{ song_id: 1339120684, why: '爵士标准曲' }] },
  { cue_id: 'c03', primary: { song_id: 19934752, why: '独奏钢琴，无起伏，压得住翻书声' }, alts: [{ song_id: 19934760, why: '同专辑的另一首' }, { song_id: 668486, why: '日剧主题钢琴' }] },
  { cue_id: 'c04', primary: { song_id: 17117247, why: '稀疏现代古典，悬疑不喧哗' }, alts: [{ song_id: 4346235, why: '极简' }] },
  { cue_id: 'c06', primary: { song_id: 21527159, why: '爵士三重奏，正好盖住酒吧人声' }, alts: [{ song_id: 21637664, why: '雷·查尔斯' }, { song_id: 21527116, why: '同专辑慢板' }] },
  { cue_id: 'c07', primary: { song_id: 572468958, why: '格里高利式合唱，正好是伪圣歌' }, alts: [{ song_id: 2919622, why: '女声吟唱' }] },
  { cue_id: 'c08', primary: { song_id: 423118326, why: '伯恩式弦乐脉冲，脚步感强' }, alts: [{ song_id: 1428710536, why: '追车' }] },
  { cue_id: 'c09', primary: { song_id: 1315151184, why: '恐怖片配乐，7分半够撑探索' }, alts: [{ song_id: 1070981, why: '华尔兹但阴森' }] },
  { cue_id: 'c10', primary: { song_id: 449663, why: '能剧吟唱加低频，最像癫狂之乐' }, alts: [{ song_id: 449658, why: '同专辑另一段' }] },
  { cue_id: 'c11', primary: { song_id: 1355146602, why: '宇宙尺度管弦，压得住阿撒托斯' }, alts: [{ song_id: 1355146598, why: '同专辑' }] },
  { cue_id: 'c13', primary: { song_id: 1304815423, why: '灾难片追逐，有塌陷感' }, alts: [{ song_id: 423118315, why: '伯恩式突围' }] },
  { cue_id: 'c14', primary: { song_id: 139774, why: '钢琴独奏收尾，留白' }, alts: [{ song_id: 19934757, why: '轻钢琴' }] }
]

const r = await tools.get('bgm_pick').execute({ file, picks }, exec)
console.log('pick:', r.ok, 'accepted=', r.accepted)
if (r.rejectedInputs?.length) console.log('拒绝:', r.rejectedInputs)
if (r.hints?.length) console.log('提示:', r.hints)

const sheet = await readSheet(file)
const paths = sheetPaths(file)
await atomicWrite(paths.review, renderReview(sheet))
await atomicWrite(paths.text, renderPlaylistText(sheet))
await atomicWrite(paths.csv, renderPlaylistCsv(sheet))
console.log('\n' + renderReview(sheet))

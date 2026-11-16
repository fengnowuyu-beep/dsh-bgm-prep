import * as ncm from '../lib/ncm.js'
const probes = [
  '教堂 合唱 管风琴', '圣咏 格里高利', '教堂音乐 管风琴', '恐怖 教堂 圣歌',
  '追逐 紧张 纯音乐', '逃亡 紧张', '崩塌 毁灭 纯音乐', '管风琴 恐怖'
]
for (const kw of probes) {
  const r = await ncm.searchPlaylistsCli(kw, { limit: 4 })
  console.log(`[${kw}] ${r.length} → ` + r.slice(0,3).map(p=>`${p.name}(${p.trackCount})`).join(' | '))
}

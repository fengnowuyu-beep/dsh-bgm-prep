import * as ncm from '../lib/ncm.js'
const probes = ['1920年代 爵士', '爵士 黑帮', '教堂 管风琴', '圣歌 合唱', '克苏鲁 跑团', '宇宙 恐怖 氛围']
for (const kw of probes) {
  const r = await ncm.searchPlaylistsCli(kw, { limit: 5 })
  console.log(`[${kw}] ${r.length} → ` + r.slice(0,3).map(p=>`${p.name}(${p.trackCount})`).join(' | '))
}

import { readSheet } from '../lib/store.js'
const sheet = await readSheet('F:/Data/听枫馆/模组/COC/026黑水溪/bgm/heishuixi.cues.json')
const all = []
const best = []
for (const cue of sheet.cues) {
  if (!cue.need_bgm) continue
  const scored = (cue.candidates ?? []).filter(c => Number.isFinite(c.auto?.match)).map(c => Number(c.auto.match))
  all.push(...scored)
  if (scored.length) best.push(Math.max(...scored))
}
const pct = (arr, p) => { const s=[...arr].sort((a,b)=>a-b); return s[Math.min(s.length-1, Math.floor(s.length*p))] }
console.log('全部候选 match:', all.length, '| 中位', pct(all,0.5).toFixed(2), '| P75', pct(all,0.75).toFixed(2), '| P90', pct(all,0.9).toFixed(2))
console.log('每段最高 match:', best.length, '| 中位', pct(best,0.5).toFixed(2), '| P25', pct(best,0.25).toFixed(2), '| 最低', Math.min(...best).toFixed(2), '| 最高', Math.max(...best).toFixed(2))
console.log('\n每段头名:')
for (const cue of sheet.cues) {
  if (!cue.need_bgm) continue
  const top = [...(cue.candidates ?? [])].sort((a,b)=>(b.auto?.match??-1)-(a.auto?.match??-1))[0]
  console.log(`  ${cue.id} ${cue.scene.slice(0,14)}  ${Number(top.auto?.match ?? 0).toFixed(2)}  ${top.title}（${top.auto?.top?.[0]?.[0] ?? '?'}）`)
}

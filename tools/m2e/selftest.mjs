// 端到端验证：真实 NetEase 曲目 → music2emo → analysis
import { analyzeTracks } from '../../lib/analyze.js'

const t0 = Date.now()
const run = await analyzeTracks([{ song_id: 785793, title: 'ひやむぎ、そーめん、时々うどん' }], { force: true })
console.log('elapsed', ((Date.now() - t0) / 1000).toFixed(1) + 's')
if (!run.ok) {
  console.log('FAIL', run.error)
  process.exit(1)
}
const hit = Object.values(run.results)[0]
if (!hit || hit.error) {
  console.log('TRACK FAIL', hit)
  process.exit(1)
}
const top = Object.entries(hit.probs).sort((a, b) => b[1] - a[1]).slice(0, 5)
console.log('va', hit.va)
console.log('top', top)
console.log('count', Object.keys(hit.probs).length)

import { runTagger } from '../lib/tag.js'
const t0 = Date.now()
const run = await runTagger([
  { song_id: 21527159, title: 'Almost Like Being in Love' },
  { song_id: 466233199, title: 'These Memories' }
], {})
console.log('结果:', JSON.stringify(run, null, 1))
console.log('耗时:', ((Date.now() - t0) / 1000).toFixed(1) + 's')

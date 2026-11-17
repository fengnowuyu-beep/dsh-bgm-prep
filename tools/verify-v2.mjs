import { runTagger } from '../lib/tag.js'
const t0 = Date.now()
const run = await runTagger([
  { song_id: 785793, title: 'ひやむぎ、そーめん、时々うどん', expect: ['活泼器乐', '轻快'] },
  { song_id: 3461580283, title: '燃烧', expect: ['律动', '激烈攻击'] },
  { song_id: 2724140038, title: '病变', expect: ['安静钢琴', '忧伤'] }
], {})
console.log(JSON.stringify(run, null, 1))
console.log('耗时:', ((Date.now()-t0)/1000).toFixed(1) + 's')

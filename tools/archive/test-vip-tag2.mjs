import { readCookie, runTagger } from '../lib/tag.js'
const saved = await readCookie()
const run = await runTagger([
  { song_id: 21527159, title: 'Almost Like Being in Love' },
  { song_id: 1852243698, title: '念故乡' }
], { cookie: saved })
console.log(JSON.stringify(run))

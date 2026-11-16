import { readCookie, runTagger, taggerHealth } from '../lib/tag.js'
const health = await taggerHealth()
console.log('环境:', health.ok, health.checks.map(c => `${c.name}:${c.ok ? 'ok' : 'MISSING'}`).join(' '))
const cookie = await readCookie()
console.log('读到 cookie:', cookie.length, '字符')
const tracks = [
  { song_id: 21527159, title: 'Almost Like Being in Love' },
  { song_id: 1852243698, title: '念故乡' }
]
const run = await runTagger(tracks, { cookie })
console.log('结果:', JSON.stringify(run, null, 2).slice(0, 900))

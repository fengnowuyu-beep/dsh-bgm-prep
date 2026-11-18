import { readCookieFromChrome, probeCookie, saveCookie } from '../lib/cookie.js'
import { readCookie, runTagger } from '../lib/tag.js'
const read = await readCookieFromChrome()
const probe = await probeCookie(read.cookie)
console.log('Chrome 登录态:', probe.valid, probe.nickname)
if (probe.valid) { await saveCookie(read.cookie); console.log('已保存到 settings.json') }
const saved = await readCookie()
console.log('存量 cookie 长度:', saved.length, '| 验证:', (await probeCookie(saved)).nickname)

console.log('\n=== 之前失败的会员曲，现在能打标吗 ===')
const run = await runTagger([
  { song_id: 21527159, title: 'Almost Like Being in Love' },
  { song_id: 1852243698, title: '念故乡' }
], { cookie: saved })
console.log(JSON.stringify(run, null, 1))

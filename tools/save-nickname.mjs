import { readCookie, probeCookie, saveCookie } from '../lib/cookie.js'
const cookie = await readCookie()
const probe = await probeCookie(cookie)
console.log('校验:', probe.valid, probe.nickname)
if (probe.valid) { await saveCookie(cookie, probe.nickname); console.log('已把昵称写回 settings') }

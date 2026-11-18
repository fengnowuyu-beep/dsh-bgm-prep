import { probeCookie, readCookieFromChrome } from '../lib/cookie.js'
import { readCookie } from '../lib/tag.js'
const saved = await readCookie()
console.log('存量 cookie 验证:', JSON.stringify(await probeCookie(saved)))
const r = await readCookieFromChrome()
console.log('从 Chrome 读取:', JSON.stringify(r).replace(/"cookie":"[^"]{20,}"/, '"cookie":"<省略>"'))
if (r.ok) console.log('Chrome 那枚验证:', JSON.stringify(await probeCookie(r.cookie)))

import { songUrl } from '../lib/netease.js'
import { readCookie } from '../lib/cookie.js'
const cookie = await readCookie()
const r = await songUrl(785793, cookie)
console.log(r.url)

import { chromeCookieStatus } from '../lib/cookie.js'
const t0 = Date.now()
const s = await chromeCookieStatus()
console.log('cookie-status:', JSON.stringify(s), `(${Date.now() - t0}ms)`)

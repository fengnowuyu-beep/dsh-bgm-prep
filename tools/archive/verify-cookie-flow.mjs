import { readCookieFromChrome, probeCookie, saveCookie, readCookie } from '../lib/cookie.js'
import { songUrl, createQrLogin } from '../lib/netease.js'

// 1) 从 Chrome 同步完整 cookie
const fromChrome = await readCookieFromChrome()
console.log('Chrome 同步:', fromChrome.ok, '字段', fromChrome.fields)
if (fromChrome.ok) {
  const probe = await probeCookie(fromChrome.cookie)
  console.log('验证:', probe.valid, probe.nickname)
  if (probe.valid) await saveCookie(fromChrome.cookie)
}
const cookie = await readCookie()
console.log('已存字段数:', cookie.split(';').length, '| 含 __csrf:', cookie.includes('__csrf'))

// 2) 取会员曲直链并实际下载
for (const id of [21527159, 466233199]) {
  const r = await songUrl(id, cookie)
  console.log(`song ${id}: url=${r.url ? '有' : '无'} level=${r.level} fee=${r.fee}`)
  if (r.url) {
    const a = await fetch(r.url, { headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://music.163.com/' } })
    const buf = Buffer.from(await a.arrayBuffer())
    console.log(`   CDN: ${a.status} ${a.headers.get('content-type')} ${(buf.length/1024/1024).toFixed(1)}MB`)
  }
}

// 3) 二维码接口
const qr = await createQrLogin()
console.log('扫码登录: key=', qr.key.slice(0, 8) + '…', 'url=', qr.url.slice(0, 52))

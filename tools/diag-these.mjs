import { readCookie } from '../lib/tag.js'
const u = await readCookie()
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const h = { 'user-agent': UA, referer: 'https://music.163.com/', cookie: `MUSIC_U=${u}` }
const id = 466233199
const api = `https://music.163.com/api/song/enhance/player/url?id=${id}&ids=%5B${id}%5D&br=320000`
const j = await (await fetch(api, { headers: h })).json()
const item = j?.data?.[0]
console.log('enhance:', 'url=', item?.url ? '有' : '无', 'fee=', item?.fee, 'level=', item?.level, 'code=', item?.code)
const real = item?.url
if (!real) process.exit(0)
console.log('url 前缀:', real.slice(0, 50))
const variants = [
  ['原样', real, {}],
  ['https', real.replace(/^http:/, 'https:'), {}],
  ['带头', real, h],
  ['带 Range', real, { ...h, range: 'bytes=0-1023' }]
]
for (const [label, url, headers] of variants) {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(25000) })
    console.log(`${label.padEnd(10)} -> ${r.status} ${r.headers.get('content-type')} ${r.headers.get('content-length') ?? ''}`)
  } catch (e) { console.log(`${label.padEnd(10)} -> 失败 ${e.message}`) }
}

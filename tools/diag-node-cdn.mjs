import { readCookie } from '../lib/tag.js'
const u = await readCookie()
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const h = { 'user-agent': UA, referer: 'https://music.163.com/', cookie: `MUSIC_U=${u}` }
const api = 'https://music.163.com/api/song/enhance/player/url?id=21527159&ids=%5B21527159%5D&br=320000'
const j = await (await fetch(api, { headers: h })).json()
const real = j?.data?.[0]?.url
console.log('real:', (real ?? '').slice(0, 60))
for (const [label, headers] of [['无头', {}], ['带头', h]]) {
  try {
    const r = await fetch(real, { headers, signal: AbortSignal.timeout(30000) })
    const buf = r.ok ? Buffer.from(await r.arrayBuffer()) : null
    console.log(`CDN ${label}:`, r.status, r.headers.get('content-type'), buf ? `${buf.length} bytes` : '')
  } catch (e) { console.log(`CDN ${label}: 失败 ${e.message}`) }
}

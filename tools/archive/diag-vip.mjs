import { readCookie } from '../lib/tag.js'
const u = await readCookie()
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const base = { 'user-agent': UA, referer: 'https://music.163.com/', cookie: `MUSIC_U=${u}` }
const id = 21527159

for (const [name, url] of [
  ['enhance br=320000', `https://music.163.com/api/song/enhance/player/url?id=${id}&ids=%5B${id}%5D&br=320000`],
  ['song/url v1', `https://music.163.com/api/song/url?id=${id}&ids=%5B${id}%5D&br=320000`],
  ['enhance 999000', `https://music.163.com/api/song/enhance/player/url?id=${id}&ids=%5B${id}%5D&br=999000`]
]) {
  const r = await fetch(url, { headers: base, signal: AbortSignal.timeout(15000) })
  const j = await r.json().catch(() => null)
  const d = j?.data?.[0]
  console.log(`${name.padEnd(18)} code=${j?.code} url=${d?.url ? '有' : '无'} fee=${d?.fee} level=${d?.level} size=${d?.size ?? '-'} code=${d?.code ?? '-'}`)
}
// 会员状态
const v = await fetch('https://music.163.com/api/vip/info', { headers: base, signal: AbortSignal.timeout(15000) })
const vj = await v.json().catch(() => null)
console.log('VIP 接口:', v.status, 'code=', vj?.code, '| vipType=', vj?.data?.redVipLevel ?? vj?.data?.vipType ?? '(无字段)')

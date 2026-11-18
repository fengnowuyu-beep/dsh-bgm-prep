import { readCookie } from '../lib/tag.js'
const u = await readCookie()
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const h = { 'user-agent': UA, referer: 'https://music.163.com/', cookie: `MUSIC_U=${u}` }
const id = 466233199
const j = await (await fetch(`https://music.163.com/api/song/enhance/player/url?id=${id}&ids=%5B${id}%5D&br=320000`, { headers: h })).json()
const real = j.data[0].url
const r = await fetch(real, { headers: h })
console.log('status:', r.status)
console.log('server:', r.headers.get('server'), '| via:', r.headers.get('via'), '| x-cache:', r.headers.get('x-cache'))
console.log('body:', (await r.text()).replace(/\s+/g, ' ').slice(0, 300))

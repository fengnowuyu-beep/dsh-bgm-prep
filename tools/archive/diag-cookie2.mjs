import { readCookie } from '../lib/tag.js'
const u = await readCookie()
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const h = (extra = {}) => ({ 'user-agent': ua, referer: 'https://music.163.com/', origin: 'https://music.163.com', ...extra })

const tests = [
  ['account GET 仅 MUSIC_U', 'https://music.163.com/api/nuser/account/get?csrf_token=', { cookie: `MUSIC_U=${u}` }],
  ['account GET os=pc', 'https://music.163.com/api/nuser/account/get?os=pc&appver=2.9.7&csrf_token=', { cookie: `MUSIC_U=${u}` }],
  ['enhance 带 os/appver', 'https://music.163.com/api/song/enhance/player/url?id=21527159&ids=%5B21527159%5D&br=320000&os=pc&appver=2.9.7', { cookie: `MUSIC_U=${u}` }],
  ['outer/url 带 UA+referer', 'https://music.163.com/song/media/outer/url?id=21527159.mp3', { cookie: `MUSIC_U=${u}` }]
]
for (const [name, url, extra] of tests) {
  try {
    const r = await fetch(url, { headers: h(extra), redirect: 'manual', signal: AbortSignal.timeout(15000) })
    let snippet = ''
    const ct = r.headers.get('content-type') ?? ''
    if (ct.includes('json')) {
      const j = await r.json().catch(() => ({}))
      const d = j?.data?.[0]
      snippet = j?.profile ? `profile=${j.profile.nickname}` : (d ? `url=${d.url ? '有' : '无'} fee=${d.fee} code=${d.code}` : `code=${j?.code}`)
    } else {
      snippet = `type=${ct} loc=${(r.headers.get('location') ?? '').slice(0, 40)}`
    }
    console.log(`${name.padEnd(24)} -> ${r.status} | ${snippet}`)
  } catch (e) {
    console.log(`${name.padEnd(24)} -> 失败 ${e.message}`)
  }
}

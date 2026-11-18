import crypto from 'node:crypto'

const MODULUS = '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7'
const b64u = (b) => b.toString('base64url')
const PRESET = '0CoJUm6Qyw8W8jud'
const IV = Buffer.from('0102030405060708')
const aes = (t, k) => { const c = crypto.createCipheriv('aes-128-cbc', Buffer.from(k), IV); return Buffer.concat([c.update(Buffer.from(t)), c.final()]).toString('base64') }
const rsa = (t) => {
  const rev = t.split('').reverse().join(''); const buf = Buffer.alloc(128); Buffer.from(rev).copy(buf, 128 - rev.length)
  const key = crypto.createPublicKey({ key: { kty: 'RSA', n: b64u(Buffer.from(MODULUS,'hex')), e: b64u(Buffer.from('010001','hex')) }, format: 'jwk' })
  return crypto.publicEncrypt({ key, padding: crypto.constants.RSA_NO_PADDING }, buf).toString('hex')
}
const sign = (p) => { const n = crypto.randomBytes(8).toString('hex').slice(0,16); return { params: aes(aes(JSON.stringify(p), PRESET), n), encSecKey: rsa(n) } }

// 从 Chrome 取完整 cookie 串
const v = await (await fetch('http://127.0.0.1:9333/json/version')).json()
const ws = new WebSocket(v.webSocketDebuggerUrl)
const cookies = await new Promise((res) => {
  const t = setTimeout(() => res([]), 12000)
  ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Storage.getCookies', params: {} }))
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === 1) { clearTimeout(t); res(m.result?.cookies ?? []) } }
})
ws.close()
const jar = {}
for (const c of cookies) if (String(c.domain).includes('music.163.com')) jar[c.name] = c.value
const cookie = Object.entries(jar).map(([k, val]) => `${k}=${val}`).join('; ')
console.log('cookie 字段数:', Object.keys(jar).length, '| 含 __csrf:', Boolean(jar['__csrf']))

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
for (const br of [999000, 320000]) {
  const body = new URLSearchParams(sign({ ids: '[466233199]', br, csrf_token: jar['__csrf'] ?? '' }))
  const r = await fetch('https://music.163.com/weapi/song/enhance/player/url?csrf_token=', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Referer: 'https://music.163.com/', Cookie: cookie },
    body
  })
  const j = await r.json().catch(() => null)
  const d = j?.data?.[0]
  console.log(`br=${br}: code=${j?.code} url=${d?.url ? '有' : '无'} level=${d?.level} fee=${d?.fee}`)
  if (d?.url) {
    const a = await fetch(d.url, { headers: { 'User-Agent': UA, Referer: 'https://music.163.com/' } })
    console.log('   CDN:', a.status, a.headers.get('content-type'))
  }
}

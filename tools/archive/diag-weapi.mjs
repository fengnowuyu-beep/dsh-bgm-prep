import crypto from 'node:crypto'
import { readCookie } from '../lib/tag.js'

const MODULUS = '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7'
const b64u = (buf) => buf.toString('base64url')
const PRESET = '0CoJUm6Qyw8W8jud'
const IV = Buffer.from('0102030405060708')

function aes(text, key) {
  const c = crypto.createCipheriv('aes-128-cbc', Buffer.from(key), IV)
  return Buffer.concat([c.update(Buffer.from(text)), c.final()]).toString('base64')
}
function rsa(text) {
  const reversed = text.split('').reverse().join('')
  const buf = Buffer.alloc(128)
  Buffer.from(reversed).copy(buf, 128 - reversed.length)
  const key = crypto.createPublicKey({
    key: { kty: 'RSA', n: b64u(Buffer.from(MODULUS, 'hex')), e: b64u(Buffer.from('010001', 'hex')) },
    format: 'jwk'
  })
  return crypto.publicEncrypt({ key, padding: crypto.constants.RSA_NO_PADDING }, buf).toString('hex')
}
function sign(payload) {
  const nonce = crypto.randomBytes(8).toString('hex').slice(0, 16)
  return {
    params: aes(aes(JSON.stringify(payload), PRESET), nonce),
    encSecKey: rsa(nonce)
  }
}

const u = await readCookie()
const csrf = ''
const body = new URLSearchParams(sign({ ids: '[466233199]', level: 'exhigh', encodeType: 'flac', csrf_token: csrf }))
const r = await fetch(`https://music.163.com/weapi/song/enhance/player/url/v1?csrf_token=${csrf}`, {
  method: 'POST',
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    referer: 'https://music.163.com/',
    cookie: `MUSIC_U=${u}`
  },
  body
})
const j = await r.json().catch(() => null)
const d = j?.data?.[0]
console.log('weapi:', r.status, 'code=', j?.code, '| url=', d?.url ? '有' : '无', '| level=', d?.level, '| fee=', d?.fee)
if (d?.url) {
  const a = await fetch(d.url, { headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://music.163.com/' } })
  console.log('CDN:', a.status, a.headers.get('content-type'), a.headers.get('content-length'))
}

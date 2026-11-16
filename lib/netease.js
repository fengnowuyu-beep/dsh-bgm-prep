// 网易云 weapi：签名、取播放直链、扫码登录。
//
// 为什么需要这一层：只带 MUSIC_U 去取播放地址，服务端会给一条「降级链」，
// 落地到 CDN 直接 403；带上完整 cookie（含 __csrf）并把它作为 csrf_token，
// 拿到的才是能播的直链。实测：同一首歌，前者 403，后者 200 audio/mpeg。

import crypto from 'node:crypto'

const UA_WEB = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/3.0.18.203152'
const ANON_COOKIE = 'os=pc; appver=3.0.18.203152'

// weapi 的固定参数（网易云公开的网页端密钥，非机密）
const PRESET_KEY = '0CoJUm6Qyw8W8jud'
const IV = Buffer.from('0102030405060708')
const RSA_N = '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7'
const RSA_E = '010001'

function aesEncrypt(text, key) {
  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(key), IV)
  return Buffer.concat([cipher.update(Buffer.from(text)), cipher.final()]).toString('base64')
}

function rsaEncrypt(text) {
  const reversed = text.split('').reverse().join('')
  const buffer = Buffer.alloc(128)
  Buffer.from(reversed).copy(buffer, 128 - reversed.length)
  const key = crypto.createPublicKey({
    key: {
      kty: 'RSA',
      n: Buffer.from(RSA_N, 'hex').toString('base64url'),
      e: Buffer.from(RSA_E, 'hex').toString('base64url')
    },
    format: 'jwk'
  })
  return crypto.publicEncrypt({ key, padding: crypto.constants.RSA_NO_PADDING }, buffer).toString('hex')
}

export function sign(payload) {
  const nonce = crypto.randomBytes(8).toString('hex').slice(0, 16)
  return {
    params: aesEncrypt(aesEncrypt(JSON.stringify(payload), PRESET_KEY), nonce),
    encSecKey: rsaEncrypt(nonce)
  }
}

/** 从 cookie 串里取某个字段。 */
export function cookieValue(cookie, name) {
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(String(cookie ?? ''))
  return match ? match[1] : ''
}

export function csrfOf(cookie) {
  return cookieValue(cookie, '__csrf')
}

async function weapiPost(path, payload, cookie) {
  const body = new URLSearchParams(sign(payload))
  const res = await fetch(`https://music.163.com${path}?csrf_token=`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': UA_WEB,
      referer: 'https://music.163.com/',
      cookie: cookie || ANON_COOKIE
    },
    body,
    signal: AbortSignal.timeout(20000)
  })
  const json = await res.json().catch(() => null)
  if (json === null) throw new Error(`weapi ${path} 返回的不是 JSON（HTTP ${res.status}）`)
  return json
}

async function formPost(url, params, cookie) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': UA_DESKTOP,
      referer: 'https://music.163.com/',
      ...(cookie ? { cookie } : {})
    },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(20000)
  })
  const json = await res.json().catch(() => null)
  const setCookie = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  return { status: res.status, json, setCookie }
}

const QUALITY_BR = { standard: 128000, high: 320000, exhigh: 320000, lossless: 999000 }

/**
 * 取播放直链。
 * @returns {Promise<{url:string, level:string, br:number, fee:number, code:number, trial:boolean}>}
 */
export async function songUrl(songId, cookie, quality = 'lossless') {
  const id = String(songId).trim()
  if (!/^\d+$/.test(id)) throw new Error(`song id 不合法：${songId}`)
  const br = QUALITY_BR[quality] ?? 999000
  const json = await weapiPost('/weapi/song/enhance/player/url', {
    ids: `[${id}]`,
    br,
    csrf_token: csrfOf(cookie)
  }, cookie)
  const item = (json?.data ?? [])[0] ?? {}
  return {
    url: String(item.url ?? ''),
    level: String(item.level ?? ''),
    br: Number(item.br ?? 0),
    fee: Number(item.fee ?? 0),
    code: Number(item.code ?? 0),
    trial: Boolean(item.freeTrialInfo)
  }
}

/** 当前 cookie 的账号；未登录返回 null。 */
export async function account(cookie) {
  if (!cookie) return null
  const json = await weapiPost('/weapi/nuser/account/get', { csrf_token: csrfOf(cookie) }, cookie)
  const nickname = String(json?.profile?.nickname ?? '')
  const id = json?.account?.id ?? null
  if (!id && nickname === '') return null
  return { id, nickname }
}

/** 出二维码：返回 unikey 与扫码后要打开的登录链接。 */
export async function createQrLogin() {
  const res = await formPost('https://interface.music.163.com/api/login/qrcode/unikey', { type: '3' })
  const code = Number(res.json?.code ?? 0)
  const unikey = String(res.json?.unikey ?? '')
  if (code !== 200 || unikey === '') {
    throw new Error(`二维码接口异常：code=${code} ${res.json?.message ?? ''}`.trim())
  }
  return {
    key: unikey,
    url: `https://music.163.com/login?codekey=${encodeURIComponent(unikey)}`
  }
}

const QR_STATUS = { 800: 'expired', 801: 'waiting', 802: 'scanned', 803: 'ok' }

/**
 * 轮询扫码状态。803 时返回完整 cookie 串（含 MUSIC_U 与 __csrf）。
 * @returns {Promise<{status:'waiting'|'scanned'|'ok'|'expired'|'failed', cookie?:string, message?:string}>}
 */
export async function pollQrLogin(key) {
  const res = await formPost('https://interface.music.163.com/api/login/qrcode/client/login', { key: String(key), type: '3' })
  const status = QR_STATUS[Number(res.json?.code ?? 0)] ?? 'failed'
  if (status !== 'ok') {
    return { status, message: String(res.json?.message ?? '') }
  }
  let cookie = String(res.json?.cookie ?? '').trim()
  if (cookie === '') {
    const parts = []
    for (const raw of res.setCookie) {
      const piece = raw.split(';')[0].trim()
      if (piece.includes('=')) parts.push(piece)
    }
    cookie = parts.join('; ')
  }
  if (cookie === '') return { status: 'failed', message: '登录成功但没拿到 cookie' }
  return { status: 'ok', cookie }
}

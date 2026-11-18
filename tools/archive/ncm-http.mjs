// 开放平台 HTTP 客户端（实验版）：签名 / 匿名 token / 端点探测
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BASE = 'https://openncm.music.163.com'
const APP_ID = 'b3010d000000000079500ce1281f0541'
const KEY = fs.readFileSync(path.join(os.homedir(), '.dsh', 'bgm-prep', 'privatekey.b64'), 'utf8').trim()
const PEM = `-----BEGIN PRIVATE KEY-----\n${KEY.replace(/(.{64})/g, '$1\n').trim()}\n-----END PRIVATE KEY-----\n`

let cachedIp = ''
async function clientIp() {
  if (cachedIp) return cachedIp
  for (const url of ['https://api.ipify.org?format=json', 'https://api.ip.sb/jsonip']) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      const json = await res.json()
      const ip = json.ip ?? json.query ?? ''
      if (typeof ip === 'string' && ip.includes('.')) { cachedIp = ip; return ip }
    } catch { /* 下个源 */ }
  }
  throw new Error('无法获取 clientIp')
}

async function buildDevice() {
  return JSON.stringify({
    deviceType: 'openapi',
    os: 'ncmcli',
    appVer: '0.1.7',
    channel: 'ncmcli',
    model: 'Windows_x64_cli',
    brand: 'ncmcli',
    osVer: os.release(),
    clientIp: await clientIp(),
    deviceId: 'ncmcli_3586f160094fe8f723389136'
  })
}

function signParams(params) {
  const canonical = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&')
  return crypto.createSign('RSA-SHA256').update(canonical, 'utf8').sign(PEM, 'base64')
}

export async function call(apiPath, biz = {}, token = '') {
  const params = {
    appId: APP_ID,
    signType: 'RSA_SHA256',
    timestamp: String(Date.now()),
    device: await buildDevice(),
    bizContent: JSON.stringify(biz)
  }
  if (token) params.accessToken = token
  params.sign = signParams(params)
  const url = `${BASE}${apiPath}?${new URLSearchParams(params).toString()}`
  const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(15000) })
  const text = await res.text()
  try { return JSON.parse(text) } catch { return { code: '-', message: text.slice(0, 300) } }
}

export async function postJson(apiPath, biz = {}) {
  const params = {
    appId: APP_ID,
    signType: 'RSA_SHA256',
    timestamp: String(Date.now()),
    device: await buildDevice(),
    bizContent: JSON.stringify(biz)
  }
  params.sign = signParams(params)
  const res = await fetch(`${BASE}${apiPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(15000)
  })
  const text = await res.text()
  try { return JSON.parse(text) } catch { return { code: '-', message: text.slice(0, 300) } }
}

if (process.argv[2] === 'probe') {
  const anon = await postJson('/openapi/music/basic/oauth2/login/anonymous', { clientId: APP_ID })
  console.log('匿名登录:', JSON.stringify(anon).slice(0, 400))
  const token = anon?.data?.accessToken ?? anon?.data?.token ?? ''

  const cases = [
    ['/openapi/music/basic/search/song/get/v2', { keyword: '地城', limit: 5, offset: 0 }],
    ['/openapi/music/basic/search/album/get/v2', { keyword: '地城', limit: 5, offset: 0 }],
    ['/openapi/music/basic/search/playlist/get/v2', { keyword: '跑团 BGM', limit: 5, offset: 0 }],
    ['/openapi/music/basic/search/artists/get/v2', { keyword: '泽野弘之', limit: 5, offset: 0 }],
    ['/openapi/music/basic/search/hot/keyword/get/v2', {}],
    ['/openapi/music/basic/playlist/detail/get/v2', { id: 3778678 }],
    ['/openapi/music/basic/playlist/detail/get', { id: 3778678 }],
    ['/openapi/music/basic/song/detail/get/v2', { songIds: [19723756] }],
    ['/openapi/music/basic/song/url/get/v2', { songIds: [19723756], level: 'standard' }],
    ['/openapi/music/basic/user/playlist/get/v2', { uid: 1 }],
    ['/openapi/music/basic/recommend/playlist/get', {}],
    ['/openapi/music/basic/similar/song/list/get/v2', { songId: 19723756 }],
    ['/openapi/music/basic/toplist/get/v2', {}],
    ['/openapi/music/basic/user/profile/get/v2', {}]
  ]
  for (const [p, biz] of cases) {
    const r = await call(p, biz, token)
    const msg = String(r.message ?? r.msg ?? '').replace(/\s+/g, ' ').slice(0, 120)
    const keys = r.data ? Object.keys(r.data).slice(0, 6).join(',') : ''
    console.log(`[${String(r.code).padStart(5)}] ${p}  :: ${msg} ${keys ? '| data keys: ' + keys : ''}`)
  }
}

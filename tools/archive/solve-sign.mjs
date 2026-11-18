// 用抓到的真实请求（参数 + sign）在本地反推签名原文。
// 纯离线计算：对候选规范化串逐一签名，与捕获到的 sign 比对。
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const LOG = path.join(os.homedir(), '.dsh', 'bgm-prep', 'spy.log')
const KEY = fs.readFileSync(path.join(os.homedir(), '.dsh', 'bgm-prep', 'privatekey.b64'), 'utf8').trim()
const PEM = `-----BEGIN PRIVATE KEY-----\n${KEY.replace(/(.{64})/g, '$1\n').trim()}\n-----END PRIVATE KEY-----\n`

const urls = fs.readFileSync(LOG, 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => { try { return JSON.parse(line) } catch { return null } })
  .filter((x) => x && typeof x.href === 'string' && x.href.includes('openncm.music.163.com'))

if (urls.length === 0) { console.error('spy.log 里没有 openncm 请求'); process.exit(2) }

function sign(text) {
  return crypto.createSign('RSA-SHA256').update(text, 'utf8').sign(PEM, 'base64')
}

const builders = {
  '按 key 升序 k=v&（原值）': (p) => Object.keys(p).sort().map((k) => `${k}=${p[k]}`).join('&'),
  '按 key 升序 k=v&（值编码）': (p) => Object.keys(p).sort().map((k) => `${k}=${encodeURIComponent(p[k])}`).join('&'),
  '按 key 升序 k=v&（键值都编码）': (p) => Object.keys(p).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(p[k])}`).join('&'),
  '插入顺序 k=v&（原值）': (p) => Object.keys(p).map((k) => `${k}=${p[k]}`).join('&'),
  '插入顺序 k=v&（值编码）': (p) => Object.keys(p).map((k) => `${k}=${encodeURIComponent(p[k])}`).join('&'),
  '插入顺序 去掉 accessToken': (p) => Object.keys(p).filter((k) => k !== 'accessToken').map((k) => `${k}=${p[k]}`).join('&'),
  '升序 去掉 accessToken': (p) => Object.keys(p).filter((k) => k !== 'accessToken').sort().map((k) => `${k}=${p[k]}`).join('&'),
  '升序 JSON': (p) => JSON.stringify(Object.fromEntries(Object.keys(p).sort().map((k) => [k, p[k]]))),
  '插入顺序 JSON': (p) => JSON.stringify(p),
  '只拼值（插入序）': (p) => Object.keys(p).map((k) => p[k]).join(''),
  '只拼值（升序）': (p) => Object.keys(p).sort().map((k) => p[k]).join(''),
  'appId+timestamp': (p) => `${p.appId}${p.timestamp}`,
  'bizContent+timestamp': (p) => `${p.bizContent}${p.timestamp}`,
  '全量 k=v& 不含 sign 且值不编码，键升序，尾加 &': (p) => Object.keys(p).sort().map((k) => `${k}=${p[k]}`).join('&') + '&'
}

let solved = false
for (const entry of urls) {
  const u = new URL(entry.href)
  const params = {}
  for (const [k, v] of u.searchParams.entries()) {
    if (k === 'sign') continue
    params[k] = v
  }
  const expected = u.searchParams.get('sign')
  if (!expected) continue
  console.log(`\n== ${u.pathname} ==`)
  console.log('参数键:', Object.keys(params).join(','))
  for (const [label, build] of Object.entries(builders)) {
    const got = sign(build(params))
    if (got === expected) {
      console.log(`  ✅ 命中：${label}`)
      console.log(`     原文样例: ${build(params).slice(0, 200)}`)
      solved = true
      break
    }
  }
  if (solved) break
}

if (!solved) {
  console.log('\n未命中，打印一条待分析的参数表：')
  const u = new URL(urls[0].href)
  for (const [k, v] of u.searchParams.entries()) console.log(`  ${k} = ${v.slice(0, 160)}`)
  process.exit(1)
}

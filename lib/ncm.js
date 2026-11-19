// 网易云音乐开放平台 HTTP 适配层。
//
// 这里的事实全部来自实测（见 docs/spike-0.md）：
//   · 真域名是 openncm.music.163.com，不是文档写的 openapi.music.163.com
//   · 签名 = 参数按键名升序、`k=v` 原值用 & 拼接 → RSA-SHA256 → base64
//   · 普通接口走 GET + 查询串；匿名登录走 POST + JSON body
//   · device 必须是 JSON 字符串，且必含 clientIp
//   · 这一层（HTTP 开放平台）的 search/song 被按应用权限拒绝（300）；
//     搜歌/读歌单/建歌单实际走下面的 ncm-cli 通道（另一套授权，实测可用）
//
// 本文件是唯一允许出现签名、HTTP、密钥路径的地方。其余模块只依赖它导出的函数。

import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

// 允许测试把域名指向本地 mock（生产永远走官方域名）。
const BASE = (process.env.NCM_BASE || 'https://openncm.music.163.com').replace(/\/$/, '')

const APP = '/openapi/music/basic'
export const API = {
  anonymous: `${APP}/oauth2/login/anonymous`,
  qrcode: `${APP}/user/oauth2/qrcodekey/get/v2`,
  qrPoll: `${APP}/oauth2/device/login/qrcode/get`,
  profile: `${APP}/user/profile/get/v2`,
  searchPlaylist: `${APP}/search/playlist/get/v2`,
  searchAlbum: `${APP}/search/album/get/v2`,
  playlistDetail: `${APP}/playlist/detail/get/v2`,
  songDetail: `${APP}/song/detail/get/v2`
}

export class NcmError extends Error {
  constructor(code, message, hint) {
    super(message)
    this.name = 'NcmError'
    this.code = code
    this.hint = hint
  }
}

// ---------------------------------------------------------------- 路径

export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

export function dataDir() {
  return path.join(dshHome(), 'bgm-prep')
}

export function credentialsPath() {
  return path.join(dataDir(), 'credentials.json')
}

export function tokenPath() {
  return path.join(dataDir(), 'token.json')
}

export function devicePath() {
  return path.join(dataDir(), 'device.json')
}

// ---------------------------------------------------------------- 凭据

export function readCredentials() {
  try {
    const raw = JSON.parse(fs.readFileSync(credentialsPath(), 'utf8'))
    if (!raw?.appId || !raw?.privateKey) return null
    return { appId: String(raw.appId), privateKey: String(raw.privateKey) }
  } catch {
    return null
  }
}

export async function writeCredentials({ appId, privateKey }) {
  const key = String(privateKey || '').trim()
  if (!key.includes('BEGIN')) {
    // 允许粘贴不带 PEM 头的裸 base64
    crypto.createPrivateKey(`-----BEGIN PRIVATE KEY-----\n${key.replace(/(.{64})/g, '$1\n').trim()}\n-----END PRIVATE KEY-----\n`)
  }
  await fsp.mkdir(dataDir(), { recursive: true })
  await atomicWrite(credentialsPath(), JSON.stringify({ appId: String(appId).trim(), privateKey: key }, null, 2))
  try { await fsp.chmod(credentialsPath(), 0o600) } catch { /* Windows 上可能不支持 */ }
}

export function privateKeyPem(raw) {
  if (raw.includes('BEGIN')) return raw.replace(/\\n/g, '\n')
  return `-----BEGIN PRIVATE KEY-----\n${raw.replace(/(.{64})/g, '$1\n').trim()}\n-----END PRIVATE KEY-----\n`
}

// ---------------------------------------------------------------- 原子写

export async function atomicWrite(file, content) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  await fsp.writeFile(tmp, content, 'utf8')
  await fsp.rename(tmp, file)
}

// ---------------------------------------------------------------- 设备

let cachedIp = ''

const IP_SOURCES = [
  'https://api.ipify.org?format=json',
  'https://api.ip.sb/jsonip',
  'https://icanhazip.com',
  'https://ifconfig.me/ip'
]

function looksLikeIp(value) {
  return typeof value === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(value.trim())
}

async function fetchClientIp() {
  if (cachedIp) return cachedIp
  if (process.env.NCM_CLIENT_IP) {
    cachedIp = process.env.NCM_CLIENT_IP
    return cachedIp
  }
  for (const url of IP_SOURCES) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      const text = (await res.text()).trim()
      let ip = ''
      if (text.startsWith('{')) {
        const json = JSON.parse(text)
        ip = json?.ip ?? json?.query ?? ''
      } else {
        ip = text
      }
      if (looksLikeIp(ip)) {
        cachedIp = ip.trim()
        return cachedIp
      }
    } catch { /* 换下一个源 */ }
  }
  throw new NcmError('no-client-ip', '拿不到本机出口 IP，开放平台要求 device.clientIp。', '检查网络或代理设置，或设置环境变量 NCM_CLIENT_IP 手动指定。')
}

async function deviceJson() {
  let stored = {}
  try {
    stored = JSON.parse(await fsp.readFile(devicePath(), 'utf8'))
  } catch { /* 首次运行 */ }
  if (!stored.deviceId) {
    stored.deviceId = `ncmcli_${crypto.randomBytes(12).toString('hex')}`
  }
  let ip = ''
  try {
    ip = await fetchClientIp()
    if (stored.clientIp !== ip) {
      stored.clientIp = ip
      await atomicWrite(devicePath(), JSON.stringify(stored, null, 2))
    }
  } catch (error) {
    if (looksLikeIp(stored.clientIp)) {
      ip = stored.clientIp // 上次拿到的出口 IP，暂时够用
    } else {
      throw error
    }
  }
  return JSON.stringify({
    deviceType: 'openapi',
    os: 'ncmcli',
    appVer: '0.1.7',
    channel: 'ncmcli',
    model: 'Windows_x64_cli',
    brand: 'ncmcli',
    osVer: os.release(),
    clientIp: ip,
    deviceId: stored.deviceId
  })
}

// ---------------------------------------------------------------- 签名

export function signParams(params, privateKey) {
  const canonical = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&')
  return crypto.createSign('RSA-SHA256').update(canonical, 'utf8').sign(privateKeyPem(privateKey), 'base64')
}

// ---------------------------------------------------------------- 调用

function requireCreds() {
  const creds = readCredentials()
  if (!creds) {
    throw new NcmError('no-credentials', '还没有配置开放平台凭据。', `先运行一次：node scripts/setup.mjs（写入 ${credentialsPath()}）`)
  }
  return creds
}

const CODE_HINTS = {
  300: '应用没有被授权调用这个接口。开放平台的接口权限是按应用申请的，改不了，只能换接口。',
  301: '需要先登录你自己的网易云账号（用户级授权）。',
  1406: 'accessToken 过期，重新登录或刷新。',
  1407: '登录态失效，需要重新扫码。',
  1408: '登录态失效，需要重新扫码。',
  2509: '缺少 accessToken。',
  2510: '缺少 device 参数。',
  2511: '缺少 clientIp 参数。',
  2512: '缺少 sign 参数。',
  '-444': '触发限流，稍后再试。',
  '-445': '触发限流，稍后再试。',
  '-446': '触发限流，稍后再试。'
}

function toError(json, apiPath) {
  const code = json?.code ?? json?.subCode ?? '-'
  const message = String(json?.message || json?.msg || '未知错误')
  const hint = CODE_HINTS[code]
  return new NcmError(code, `[${code}] ${message}${hint ? ` —— ${hint}` : ''}`, hint)
}

async function parse(res) {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new NcmError('bad-json', `开放平台返回了非 JSON 内容：${text.slice(0, 200)}`)
  }
}

/** 调试用：返回原始状态与文本，不抛错。 */
export async function rawGet(apiPath, biz = {}, token = '') {
  const creds = requireCreds()
  const params = {
    appId: creds.appId,
    signType: 'RSA_SHA256',
    timestamp: String(Date.now()),
    device: await deviceJson(),
    bizContent: JSON.stringify(biz)
  }
  if (token) params.accessToken = token
  params.sign = signParams(params, creds.privateKey)
  const url = `${BASE}${apiPath}?${new URLSearchParams(params).toString()}`
  const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(20000) })
  return { status: res.status, body: await res.text() }
}

export async function get(apiPath, biz = {}, token = '') {
  const creds = requireCreds()
  const params = {
    appId: creds.appId,
    signType: 'RSA_SHA256',
    timestamp: String(Date.now()),
    device: await deviceJson(),
    bizContent: JSON.stringify(biz)
  }
  if (token) params.accessToken = token
  params.sign = signParams(params, creds.privateKey)
  const url = `${BASE}${apiPath}?${new URLSearchParams(params).toString()}`
  const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(20000) })
  const json = await parse(res)
  if (json?.code !== 200) throw toError(json, apiPath)
  return json
}

export async function post(apiPath, biz = {}, token = '') {
  const creds = requireCreds()
  const params = {
    appId: creds.appId,
    signType: 'RSA_SHA256',
    timestamp: String(Date.now()),
    device: await deviceJson(),
    bizContent: JSON.stringify(biz)
  }
  if (token) params.accessToken = token
  params.sign = signParams(params, creds.privateKey)
  const res = await fetch(`${BASE}${apiPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(20000)
  })
  const json = await parse(res)
  if (json?.code !== 200) throw toError(json, apiPath)
  return json
}

// ---------------------------------------------------------------- 登录态

export function readToken() {
  try {
    const raw = JSON.parse(fs.readFileSync(tokenPath(), 'utf8'))
    const nested = raw?.accessToken && typeof raw.accessToken === 'object' ? raw.accessToken : null
    const accessToken = nested ? nested.accessToken : raw?.accessToken
    if (!accessToken || typeof accessToken !== 'string') return null
    const expireIn = nested?.expireTime ?? raw?.expireTime
    return {
      accessToken,
      refreshToken: nested?.refreshToken ?? raw?.refreshToken ?? '',
      anonymous: raw?.anonymous === true,
      savedAt: raw?.savedAt,
      expireAt: raw?.expireAt ?? (expireIn ? Date.now() + Number(expireIn) * 1000 : 0)
    }
  } catch {
    return null
  }
}

/** 把 803 的返回（可能是扁平也可能嵌套）统一成 { accessToken, refreshToken, expireTime }。 */
export function normalizeTokenPayload(data) {
  const raw = data?.accessToken
  if (raw && typeof raw === 'object') {
    return {
      accessToken: String(raw.accessToken ?? ''),
      refreshToken: String(raw.refreshToken ?? ''),
      expireTime: Number(raw.expireTime ?? data?.expireIn ?? 86400)
    }
  }
  return {
    accessToken: typeof raw === 'string' ? raw : '',
    refreshToken: String(data?.refreshToken ?? ''),
    expireTime: Number(data?.expireTime ?? data?.expireIn ?? 86400)
  }
}

export async function anonymousToken() {
  const creds = requireCreds()
  const json = await post(API.anonymous, { clientId: creds.appId })
  const t = normalizeTokenPayload(json.data ?? {})
  if (!t.accessToken) throw new NcmError('no-anon-token', '匿名登录没有返回 accessToken。')
  return { accessToken: t.accessToken, refreshToken: t.refreshToken, anonymous: true, expireAt: Date.now() + t.expireTime * 1000 }
}

/** 用户 token；没有就退回匿名 token。 */
export async function activeToken() {
  const saved = readToken()
  if (saved && !saved.anonymous && saved.accessToken && (!saved.expireAt || saved.expireAt > Date.now() + 60_000)) {
    return saved.accessToken
  }
  const anon = await anonymousToken()
  return anon.accessToken
}

export function hasUserToken() {
  const saved = readToken()
  return Boolean(saved && !saved.anonymous && saved.accessToken)
}

// ---------------------------------------------------------------- CLI 通道
//
// 数据类操作（搜歌、读歌单曲目、建歌单、加曲）走官方 CLI 的动态命令：
// 登录后 ncm-cli 才会注册 search / playlist 等命令，而这些能力在开放平台
// HTTP 接口上被应用权限挡住了（300）。CLI 通道用的是另一套授权，实测可用。
//
// ⚠️ 这一层**必须**用异步 spawn，不能用 spawnSync。
// spawnSync 会在子进程整个生命周期内钉死 Node 的事件循环，而插件和 DSH 的
// Web 服务、会话读写跑在同一个进程里——2026-11-19 实测：一次 bgm_fetch 里
// 5 次 CLI 调用串起来约 25 秒，这期间 DSH 切任何对话都停在「载入历史」，
// 用户只能强杀进程。再叠上单次 90 秒超时，最坏能冻结一分半钟。
// 换成异步后同样的调用时长，界面全程可用。

const CLI_MAX_OUTPUT = 64 * 1024 * 1024
/** 只读检索的进程内缓存：同一关键词在一轮备团里会被反复问到。 */
const CLI_CACHE_TTL_MS = 10 * 60 * 1000
const CLI_CACHE_MAX = 400

function cliEntry() {
  return process.env.NCM_CLI || path.join(dataDir(), 'vendor', 'node_modules', '@music163', 'ncm-cli', 'dist', 'index.js')
}

function parseJsonLoose(text) {
  const trimmed = text.trim()
  if (!trimmed) return null
  try { return JSON.parse(trimmed) } catch { /* 往下找 */ }
  const start = trimmed.search(/[[{]/)
  if (start === -1) return null
  try { return JSON.parse(trimmed.slice(start)) } catch { return null }
}

/**
 * 起一次 ncm-cli 并等它结束。返回 {status,stdout,stderr,timedOut} 或 {error}，
 * 不抛异常——分类交给调用方，行为与原 spawnSync 版本一致。
 * stdin 用 'ignore'：CLI 不需要输入，留着管道只会在退出时多一个 EPIPE。
 */
function runCliProcess(entry, args, { timeout }) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    let child = null
    let timer = null

    const finish = (payload) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(payload)
    }

    try {
      child = spawn(process.execPath, [entry, ...args, '--output', 'json'], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (error) {
      finish({ error })
      return
    }

    if (timeout > 0) {
      timer = setTimeout(() => {
        timedOut = true
        try { child.kill('SIGKILL') } catch { /* 已经退出 */ }
      }, timeout)
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      // 超量就砍，别让异常输出把主进程的内存吃满
      if (stdout.length > CLI_MAX_OUTPUT) {
        try { child.kill('SIGKILL') } catch { /* 已经退出 */ }
      }
    })
    child.stderr.on('data', (chunk) => {
      // 只留末尾一段：CLI 的报错信息很短，没必要无限增长
      stderr = `${stderr}${chunk}`.slice(-64 * 1024)
    })
    child.on('error', (error) => finish({ error }))
    child.on('close', (status, signal) => finish({ status, signal, stdout, stderr, timedOut }))
  })
}

/** 跑一次 ncm-cli，返回解析后的 JSON（{code,data,...}）。全程不阻塞事件循环。 */
export async function cli(args, { timeout = 90000 } = {}) {
  const entry = cliEntry()
  if (!fs.existsSync(entry)) {
    throw new NcmError('no-cli', `找不到 ncm-cli：${entry}`, '把 @music163/ncm-cli 装到 $DSH_HOME/bgm-prep/vendor。')
  }
  const r = await runCliProcess(entry, args, { timeout })
  if (r.error) {
    throw new NcmError('cli-failed', `启动 ncm-cli 失败：${r.error.message}`)
  }
  const raw = `${r.stdout || ''}`
  const errText = `${r.stderr || ''}`.trim()
  const json = parseJsonLoose(raw)
  // 超时先判：被 SIGKILL 时 status 是 null，落到下面会报成「exit null」，看不出是超时
  if (r.timedOut) {
    throw new NcmError('cli-timeout', `ncm-cli 超时（${timeout}ms，${args.join(' ')}）`, '网络卡住或登录态异常，稍后重试。')
  }
  if (r.status !== 0) {
    const detail = errText || raw.trim().slice(0, 300) || `exit ${r.status}`
    if (/已登录|login/i.test(detail)) {
      throw new NcmError('cli-not-logged-in', `ncm-cli 未登录：${detail.slice(0, 160)}`, '运行 node scripts/setup.mjs --cli-login 完成扫码。')
    }
    throw new NcmError('cli-failed', `ncm-cli 执行失败（${args.join(' ')}）：${detail.slice(0, 240)}`)
  }
  if (json && json.code !== undefined && json.code !== 200) {
    throw new NcmError(json.code, `[${json.code}] ${json.message ?? json.msg ?? '未知错误'}（${args.join(' ')}）`)
  }
  return json?.data ?? json
}

// ---------------------------------------------------------------- CLI 结果缓存
//
// 一轮备团里同样的关键词会被反复问到：`force` 重抓、多段共用同一个歌单、
// 改权重后重算……每问一次就是一次进程启动加几秒网络。只缓存只读命令。

const cliCache = new Map()
const cliInflight = new Map()

function cacheableArgs(args) {
  if (args[0] === 'search') return true
  if (args[0] === 'playlist' && (args[1] === 'tracks' || args[1] === 'created')) return true
  if (args[0] === 'login' && args.includes('--check')) return true
  return false
}

/** 测试用：清掉缓存，让每个用例从干净状态开始。 */
export function clearCliCache() {
  cliCache.clear()
  cliInflight.clear()
}

function cacheGet(key) {
  const hit = cliCache.get(key)
  if (!hit) return undefined
  if (Date.now() - hit.at > CLI_CACHE_TTL_MS) {
    cliCache.delete(key)
    return undefined
  }
  return hit.value
}

function cacheSet(key, value) {
  if (cliCache.size >= CLI_CACHE_MAX) {
    // Map 保持插入顺序，删最早的一条就是最省事的淘汰
    const oldest = cliCache.keys().next().value
    if (oldest !== undefined) cliCache.delete(oldest)
  }
  cliCache.set(key, { at: Date.now(), value })
}

async function cliData(args, options) {
  // 写操作绝不能命中缓存，而且要让旧缓存立刻失效（加完曲目 tracks 就变了）
  if (!cacheableArgs(args)) {
    clearCliCache()
    return cli(args, options)
  }

  const key = args.join('\u0000')
  const cached = cacheGet(key)
  if (cached !== undefined) return structuredClone(cached)

  // 同一关键词在同一轮里被两段同时问到：并到同一个 in-flight 上，别再起一个进程
  const pending = cliInflight.get(key)
  if (pending) return structuredClone(await pending)

  const task = cli(args, options)
    .then((value) => {
      cacheSet(key, value)
      return value
    })
    .finally(() => {
      cliInflight.delete(key)
    })
  cliInflight.set(key, task)
  // 克隆后返回：调用方拿到的是自己的副本，改它不会污染缓存
  return structuredClone(await task)
}

// ---------------------------------------------------------------- 业务接口（CLI）

export async function searchSongs(keyword, { limit = 30, offset = 0 } = {}) {
  const data = await cliData(['search', 'song', '--keyword', keyword, '--limit', String(limit), '--offset', String(offset)])
  return data?.records ?? []
}

export async function searchPlaylistsCli(keyword, { limit = 10 } = {}) {
  const data = await cliData(['search', 'playlist', '--keyword', keyword, '--limit', String(limit)])
  return data?.records ?? []
}

export async function playlistTracks(playlistId, { limit = 500, offset = 0 } = {}) {
  const data = await cliData(['playlist', 'tracks', '--playlistId', String(playlistId), '--limit', String(limit), '--offset', String(offset)])
  // 实测：歌单曲目接口的 data 直接是数组，不是 {records}
  if (Array.isArray(data)) return data
  return data?.records ?? data?.tracks ?? data?.songs ?? []
}

export async function myPlaylists({ limit = 50 } = {}) {
  const data = await cliData(['playlist', 'created', '--limit', String(limit)])
  return data?.records ?? []
}

export async function createPlaylist(name) {
  return cliData(['playlist', 'create', '--playlistName', name])
}

export async function renamePlaylist(playlistId, name) {
  return cliData(['playlist', 'updateName', '--playlistId', String(playlistId), '--name', String(name)])
}

/** 更新歌单描述（歌单说明）：把「场景 → BGM」的对照写进去。 */
export async function updatePlaylistDesc(playlistId, desc) {
  return cliData(['playlist', 'updateDesc', '--playlistId', String(playlistId), '--desc', String(desc)])
}

export async function addPlaylistTracks(playlistId, encryptedSongIds) {
  if (encryptedSongIds.length === 0) return null
  return cliData(['playlist', 'add', '--playlistId', String(playlistId), '--songIdList', JSON.stringify(encryptedSongIds)])
}

export async function removePlaylistTracks(playlistId, encryptedSongIds) {
  if (encryptedSongIds.length === 0) return null
  return cliData(['playlist', 'remove', '--playlistId', String(playlistId), '--songIdList', JSON.stringify(encryptedSongIds)])
}

export async function cliLoggedIn() {
  try {
    const data = await cliData(['login', '--check'])
    return data?.success === true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- 业务接口（HTTP，登录用）

export async function profile() {
  const json = await get(API.profile, {}, await activeToken())
  return json.data
}

export async function searchPlaylists(keyword, { limit = 10, offset = 0 } = {}) {
  const json = await get(API.searchPlaylist, { keyword, limit, offset }, await activeToken())
  return json.data
}

export async function searchAlbums(keyword, { limit = 10, offset = 0 } = {}) {
  const json = await get(API.searchAlbum, { keyword, limit, offset }, await activeToken())
  return json.data
}

export async function playlistDetail(id) {
  const json = await get(API.playlistDetail, { id: Number(id) }, await activeToken())
  return json.data
}

export async function songDetail(songIds) {
  const ids = (Array.isArray(songIds) ? songIds : [songIds]).map(Number).filter(Number.isFinite)
  const json = await get(API.songDetail, { songIds: ids }, await activeToken())
  return json.data
}

// ---------------------------------------------------------------- 扫码登录

export async function createQrCode() {
  const json = await get(API.qrcode, { type: 2, expiredKey: '300' }, await activeToken())
  const data = json.data ?? {}
  return { key: data.uniKey ?? data.key, url: data.qrCodeUrl ?? data.url }
}

export async function pollQrCode(key) {
  const creds = requireCreds()
  const json = await get(API.qrPoll, { key, clientId: creds.appId }, await activeToken())
  return json.data ?? {}
}

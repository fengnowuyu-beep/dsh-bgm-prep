// 播放凭据：存取、验证、以及从 Chrome 只读同步。
//
// 关键约定：**存的是完整 cookie 串**（MUSIC_U + __csrf + …），不是单独一个 MUSIC_U。
// 只带 MUSIC_U 去取播放直链，服务端会返回一条用不了的降级链（CDN 403）。

import fsp from 'node:fs/promises'
import path from 'node:path'
import * as ncm from './ncm.js'
import { account } from './netease.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const CDP_ENDPOINTS = ['http://127.0.0.1:9333', 'http://127.0.0.1:9222']

export function settingsPath() {
  return path.join(ncm.dataDir(), 'settings.json')
}

async function readRaw() {
  try {
    return JSON.parse(await fsp.readFile(settingsPath(), 'utf8'))
  } catch {
    return {}
  }
}

/** 规范化：允许传 "MUSIC_U=xxx" 或裸值，也接受完整 "k=v; k=v" 串。 */
export function normalizeCookie(input) {
  let text = String(input ?? '').trim()
  if (text === '') return ''
  if (!text.includes(';') && !text.includes('=')) return `MUSIC_U=${text}`
  if (!text.includes(';') && text.startsWith('MUSIC_U=')) return text
  return text.replace(/\s*;\s*/g, '; ').trim()
}

export async function readCookie() {
  const raw = await readRaw()
  const full = normalizeCookie(raw.musicCookie)
  if (full !== '') return full
  // 旧版本只存了 MUSIC_U，读出来继续用（但取链质量会差，登录一次即可升级）
  return normalizeCookie(raw.musicUCookie)
}

export async function saveCookie(input, nickname = '') {
  const value = normalizeCookie(input)
  const current = await readRaw()
  const next = { ...current, musicCookie: value, musicNickname: String(nickname ?? '') || current.musicNickname || '' }
  if (current.musicUCookie !== undefined) delete next.musicUCookie
  await ncm.atomicWrite(settingsPath(), JSON.stringify(next, null, 2))
  return value
}

export async function clearCookie() {
  const current = await readRaw()
  const next = { ...current, musicCookie: '' }
  if (current.musicUCookie !== undefined) delete next.musicUCookie
  await ncm.atomicWrite(settingsPath(), JSON.stringify(next, null, 2))
}

/** 这串 cookie 到底登录了没有（问服务端，不看过期时间）。 */
export async function probeCookie(input) {
  const cookie = normalizeCookie(input)
  if (cookie === '') return { valid: false, reason: 'empty' }
  try {
    const info = await account(cookie)
    if (info === null) return { valid: false, reason: '服务端认为未登录（会话已失效）' }
    return { valid: true, nickname: info.nickname, uid: info.id }
  } catch (error) {
    return { valid: false, reason: `校验失败：${String(error?.message ?? error).slice(0, 120)}` }
  }
}

function cdpCookies(wsUrl) {
  return new Promise((resolve) => {
    if (typeof WebSocket !== 'function') {
      resolve({ ok: false, error: '当前 Node 没有全局 WebSocket，无法连 CDP' })
      return
    }
    let settled = false
    const done = (payload) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { socket.close() } catch { /* ignore */ }
      resolve(payload)
    }
    const socket = new WebSocket(wsUrl)
    const timer = setTimeout(() => done({ ok: false, error: 'CDP 超时' }), 15000)
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: 'Storage.getCookies', params: {} }))
    socket.onmessage = (event) => {
      let msg
      try { msg = JSON.parse(event.data) } catch { return }
      if (msg.id !== 1) return
      if (msg.error) done({ ok: false, error: msg.error.message ?? 'CDP 报错' })
      else done({ ok: true, cookies: msg.result?.cookies ?? [] })
    }
    socket.onerror = () => done({ ok: false, error: 'CDP 连接失败' })
  })
}

/** 从本机真实 Chrome 同步 music.163.com 的完整 cookie 串（只读，不碰 profile 文件）。 */
export async function readCookieFromChrome() {
  for (const endpoint of CDP_ENDPOINTS) {
    let version
    try {
      const res = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(4000) })
      if (!res.ok) continue
      version = await res.json()
    } catch {
      continue
    }
    if (!version?.webSocketDebuggerUrl) continue
    const result = await cdpCookies(version.webSocketDebuggerUrl)
    if (!result.ok) return result
    const jar = {}
    let expires = 0
    for (const cookie of result.cookies) {
      if (!String(cookie.domain).includes('music.163.com')) continue
      jar[cookie.name] = cookie.value
      if (cookie.name === 'MUSIC_U') expires = cookie.expires ?? 0
    }
    if (jar.MUSIC_U === undefined) {
      return { ok: false, error: 'Chrome 里没有 MUSIC_U：在这个浏览器里登录一次 music.163.com 再点' }
    }
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')
    return { ok: true, cookie, expires, endpoint, fields: Object.keys(jar).length }
  }
  return { ok: false, error: '连不上 Chrome 调试端口（9333 / 9222）；确认 Chrome 在运行且已接管' }
}

/** 只读状态：Chrome 里有没有登录态、它是不是真的有效。不写任何东西。 */
export async function chromeCookieStatus() {
  const read = await readCookieFromChrome()
  if (!read.ok) return { chrome: false, valid: false, reason: read.error }
  const probe = await probeCookie(read.cookie)
  return {
    chrome: true,
    valid: probe.valid === true,
    nickname: probe.nickname ?? '',
    reason: probe.reason ?? '',
    expires: read.expires ?? 0,
    fields: read.fields ?? 0
  }
}


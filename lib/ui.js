// 工作台的 Host 侧：状态、路由、音频代理、工作流方法。
//
// 设计约束（references/user-actions.md）：UI 与工具必须走同一条业务逻辑，
// 所以这里不重新实现"选曲""建歌单""检索"，而是调用已注册的工具 execute()。

import fsp from 'node:fs/promises'
import path from 'node:path'
import * as ncm from './ncm.js'
import QRCode from 'qrcode'
import { openUpstream, passthroughHeaders, pipeUpstream } from './audioProxy.js'
import { cueStatus, emptySheet, readSheet, sheetPaths, writeSheet } from './store.js'
import { explainCandidate, renderPlaylistCsv, renderPlaylistText, renderReview } from './format.js'
import {
  chromeCookieStatus, clearCookie, normalizeCookie, probeCookie, readCookie, readCookieFromChrome, saveCookie
} from './cookie.js'
import { createQrLogin, pollQrLogin, songUrl } from './netease.js'
import { SEARCH_WORDS } from './search.js'
import { TAG_LABELS } from './tagLabels.js'
import { AVOID_K } from './target.js'
import { engineConfig } from './analyze.js'

export const ROUTE_PREFIX = '/bgm-prep/api'
const MAX_RECENT = 12

function statePath() {
  return path.join(ncm.dataDir(), 'ui-state.json')
}

async function readUiState() {
  try {
    const raw = JSON.parse(await fsp.readFile(statePath(), 'utf8'))
    return {
      active: typeof raw.active === 'string' ? raw.active : '',
      recent: Array.isArray(raw.recent) ? raw.recent : [],
      root: typeof raw.root === 'string' ? raw.root : ''
    }
  } catch {
    return { active: '', recent: [], root: '' }
  }
}

async function writeUiState(next) {
  await ncm.atomicWrite(statePath(), JSON.stringify(next, null, 2))
}

/** 记住一份曲目表，供工作台默认打开。工具成功执行后调用（失败不影响主流程）。 */
export async function rememberSheetFile(file) {
  if (typeof file !== 'string' || file === '') return
  try {
    const state = await readUiState()
    const recent = [{ file, at: new Date().toISOString() }, ...state.recent.filter((r) => r.file !== file)].slice(0, MAX_RECENT)
    await writeUiState({ ...state, active: file, recent })
  } catch {
    /* 记不住也不该让工具失败 */
  }
}

function historyPath() {
  return path.join(ncm.dataDir(), 'history.json')
}

// 直链缓存：拖进度条会连发好几个 Range 请求，每次都调一次 weapi 太浪费。
// 直链自带过期时间，缓存 5 分钟足够，也不会拿到过期链接。
const URL_TTL_MS = 5 * 60 * 1000
const urlCache = new Map()

async function resolveAudioUrl(id, cookie) {
  const hit = urlCache.get(id)
  if (hit && Date.now() - hit.at < URL_TTL_MS) return hit.value
  const value = await songUrl(id, cookie)
  if (value.url !== '') {
    if (urlCache.size >= 200) urlCache.clear()
    urlCache.set(id, { value, at: Date.now() })
  }
  return value
}

/** 建歌单成功后落一条历史；同一份曲目表只保留最新一条。 */
export async function recordHistory(entry) {
  try {
    let list = []
    try {
      list = JSON.parse(await fsp.readFile(historyPath(), 'utf8'))
    } catch { /* 第一次 */ }
    const next = [
      { ...entry, at: new Date().toISOString() },
      ...list.filter((item) => item.file !== entry.file)
    ].slice(0, 50)
    await ncm.atomicWrite(historyPath(), JSON.stringify(next, null, 2))
  } catch { /* 历史记不住不影响建歌单 */ }
}

export async function readHistory() {
  try {
    const list = JSON.parse(await fsp.readFile(historyPath(), 'utf8'))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

/** 设置：播放凭据 + 负向标签开关。 */
async function readSettings() {
  try {
    const raw = JSON.parse(await fsp.readFile(path.join(ncm.dataDir(), 'settings.json'), 'utf8'))
    return { musicUCookie: '', seedPlaylists: [], candidateLimit: 12, fetchBudget: 200, avoidEnabled: true, ...raw }
  } catch {
    return { musicUCookie: '', seedPlaylists: [], candidateLimit: 12, fetchBudget: 200, avoidEnabled: true }
  }
}

async function writeSettings(patch) {
  const current = await readSettings()
  const next = { ...current, ...patch }
  await ncm.atomicWrite(path.join(ncm.dataDir(), 'settings.json'), JSON.stringify(next, null, 2))
  return next
}

export class Workbench {
  constructor({ getTools, logger }) {
    this.getTools = getTools
    this.logger = logger
  }

  async resolveFile(explicit) {
    if (typeof explicit === 'string' && explicit !== '') return explicit
    const state = await readUiState()
    return state.active
  }

  async snapshot(file) {
    const state = await readUiState()
    const settings = await readSettings()
    const vocalCfg = (await engineConfig()).vocal ?? {}
    const target = await this.resolveFile(file ?? state.active)
    if (!target) {
      return {
        active: '',
        recent: state.recent,
        sheet: null,
        hasCookie: (await readCookie()) !== '',
        nickname: (await readSettings()).musicNickname ?? '',
      cookieFields: ((await readCookie()) || '').split(';').filter(Boolean).length,
        message: '还没有打开过曲目表'
      }
    }
    let sheet
    try {
      sheet = await readSheet(target)
    } catch (error) {
      return { active: target, recent: state.recent, sheet: null, hasCookie: (await readCookie()) !== '',
        nickname: settings.musicNickname ?? '',
      cookieFields: ((await readCookie()) || '').split(';').filter(Boolean).length, error: error.message }
    }
    const cues = sheet.cues.map((cue, index) => ({
      id: cue.id,
      no: index + 1,
      scene: cue.scene,
      trigger: cue.trigger ?? '',
      need_bgm: cue.need_bgm,
      target: cue.target ?? [],
      targetSource: cue.targetSource ?? 'auto',
      targetDropped: cue.targetDropped ?? [],
      vocal: cue.vocal ?? 'any',
      wants: cue.wants ?? [],
      avoids: cue.avoids ?? [],
      avoidTargets: cue.avoidTargets ?? [],
      avoidKeywords: cue.avoidKeywords ?? [],
      avoidUnverified: cue.avoidUnverified ?? [],
      status: cueStatus(cue),
      picks: cue.picks ?? null,
      note: cue.note ?? '',
      candidates: (cue.candidates ?? []).map((c) => ({
        song_id: c.song_id,
        title: c.title,
        artist: c.artist,
        album: c.album,
        source: c.source ?? '',
        analysis: c.analysis ?? null,
        duration: c.duration,
        hint: (typeof c.note === 'string' && c.note !== '') ? c.note : explainCandidate(c, cue)
      }))
    }))
    return {
      active: target,
      recent: state.recent,
      module: sheet.module,
      session: sheet.session,
      scope: sheet.scope,
      tagLabels: TAG_LABELS,
      avoidK: AVOID_K,
      avoidEnabled: settings.avoidEnabled !== false,
      vocalEnabled: vocalCfg.enabled !== false,
      vocalPenalty: Number(vocalCfg.penalty ?? 0.25),
      vocalThreshold: Number(vocalCfg.threshold ?? 0.25),
      directives: sheet.directives,
      playlistId: sheet.playlist_id ?? '',
      playlistName: sheet.playlist_name ?? '',
      export: sheet.export ?? null,
      hasCookie: (await readCookie()) !== '',
      nickname: settings.musicNickname ?? '',
      cookieFields: ((await readCookie()) || '').split(';').filter(Boolean).length,
      cues,
      stats: {
        total: cues.length,
        need: cues.filter((c) => c.need_bgm).length,
        picked: cues.filter((c) => c.status === 'picked').length,
        insufficient: cues.filter((c) => c.status === 'insufficient').length
      }
    }
  }

  async audio(request, response, songId) {
    const id = Number(songId)
    if (!Number.isFinite(id) || id <= 0) {
      writeJson(response, 400, { ok: false, error: { code: 'bad-id', message: 'song id 不合法' } })
      return
    }
    // 用完整 cookie 走 weapi 换直链。
    // 只带 MUSIC_U 时服务端会给一条用不了的降级链（CDN 403），所以必须存全。
    const cookie = await readCookie()
    let resolved
    try {
      resolved = await resolveAudioUrl(id, cookie)
    } catch (error) {
      writeJson(response, 502, { ok: false, error: { code: 'upstream', message: `取播放直链失败：${String(error?.message ?? error).slice(0, 160)}` } })
      return
    }
    if (resolved.url === '') {
      const message = resolved.code === 404
        ? '版权限制：这首在当前地区不可播放'
        : (cookie === '' ? '需要先登录网易云（播放设置 → 登录网易云）' : '账号没有这首的播放权限，或用「在 App 打开」')
      writeJson(response, 404, { ok: false, error: { code: 'not-playable', message } })
      return
    }
    // 宿主拉流再转发：浏览器只跟 127.0.0.1 说话，系统代理开着（甚至代理进程没起来）
    // 也不影响播放。Range 原样透传给 CDN，拖动进度条才有 206。
    let upstream
    try {
      upstream = await openUpstream(resolved.url, { range: request.headers.range })
    } catch (error) {
      writeJson(response, 502, { ok: false, error: { code: 'upstream', message: `取音频流失败：${String(error?.message ?? error).slice(0, 160)}` } })
      return
    }
    if (!(upstream.status >= 200 && upstream.status <= 299)) {
      upstream.stream.resume()
      writeJson(response, 502, { ok: false, error: { code: 'upstream', message: `音频源返回 ${upstream.status}` } })
      return
    }
    const headers = passthroughHeaders(upstream.headers, { level: resolved.level })
    // 桌面版可能从 app:// 之类的前端起 fetch，需要允许跨源读取；音频本身不含隐私数据
    headers['access-control-allow-origin'] = '*'
    response.writeHead(upstream.status, { ...headers, 'x-bgm-level': resolved.level || 'unknown' })
    pipeUpstream(upstream, response)
  }

  async handle(request, response) {
    const tools = this.getTools()
    const url = new URL(request.url ?? '/', 'http://dsh.internal')
    if (request.method === 'GET' && url.pathname === `${ROUTE_PREFIX}/audio`) {
      await this.audio(request, response, url.searchParams.get('id'))
      return
    }
    if (request.method !== 'POST') {
      writeJson(response, 405, { ok: false, error: { code: 'method', message: 'method not allowed' } })
      return
    }
    const method = url.pathname.startsWith(`${ROUTE_PREFIX}/`) ? url.pathname.slice(ROUTE_PREFIX.length + 1) : ''
    let body = {}
    try {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const text = Buffer.concat(chunks).toString('utf8').trim()
      body = text === '' ? {} : JSON.parse(text)
    } catch {
      writeJson(response, 400, { ok: false, error: { code: 'bad-json', message: '请求体不是合法 JSON' } })
      return
    }
    const exec = { agent: { session: { header: { cwd: process.cwd() } } } }

    try {
      if (method === 'snapshot') {
        writeJson(response, 200, { ok: true, data: await this.snapshot(body.file) })
        return
      }
      if (method === 'open') {
        const file = String(body.file ?? '').trim()
        if (file === '') throw new Error('缺少 file')
        await rememberSheetFile(file)
        writeJson(response, 200, { ok: true, data: await this.snapshot(file) })
        return
      }
      if (method === 'create-sheet') {
        const module = String(body.module ?? '').trim()
        const scope = String(body.scope ?? '').trim() || 'default'
        const dir = String(body.dir ?? '').trim()
        if (module === '' || dir === '') throw new Error('需要模组名和目录')
        const file = path.join(dir, 'bgm', `${scope}.cues.json`)
        const exists = await fsp.stat(file).then(() => true, () => false)
        if (exists) throw new Error(`已存在：${file}`)
        const sheet = emptySheet({ module, session: Number(body.session) || null, scope })
        sheet.cues = []
        sheet.createdAt = new Date().toISOString()
        await fsp.mkdir(path.dirname(file), { recursive: true })
        await writeSheet(file, sheet)
        await rememberSheetFile(file)
        writeJson(response, 200, { ok: true, data: await this.snapshot(file) })
        return
      }
      if (method === 'patch-cue' || method === 'add-cue' || method === 'delete-cue') {
        const file = await this.resolveFile(body.file)
        const sheet = await readSheet(file)
        if (method === 'add-cue') {
          const id = `c${String(sheet.cues.length + 1).padStart(2, '0')}`
          sheet.cues.push({
            id,
            scene: String(body.scene ?? '新场景').slice(0, 60),
            trigger: '',
            need_bgm: true,
            state: 'ready',
            tags: null,
            wants: [],
            avoids: [],
            candidates: [],
            picks: null,
            rejected: [],
            note: ''
          })
        } else {
          const cue = sheet.cues.find((c) => c.id === String(body.cueId))
          if (!cue) throw new Error(`找不到段 ${String(body.cueId)}`)
          if (method === 'delete-cue') {
            sheet.cues = sheet.cues.filter((c) => c.id !== cue.id)
          } else {
            if (typeof body.scene === 'string' && body.scene.trim() !== '') cue.scene = body.scene.trim().slice(0, 60)
            if (typeof body.trigger === 'string') cue.trigger = body.trigger.slice(0, 200)
            // 负向标签：整组替换（客户端改完强度/增删就发整组），权重归一化在 readSheet 里做
            if (Array.isArray(body.avoidTargets)) {
              cue.avoidTargets = body.avoidTargets
                .map((item) => ({
                  tag: String(item?.tag ?? '').trim().toLowerCase(),
                  weight: Number(item?.weight) > 0 ? Number(item.weight) : 1
                }))
                .filter((item) => item.tag !== '')
            }
            if (body.needBgm === true || body.needBgm === false) {
              cue.need_bgm = body.needBgm
              cue.state = body.needBgm ? (cue.candidates.length > 0 ? 'ready' : 'ready') : 'skipped'
              if (!body.needBgm) { cue.candidates = []; cue.picks = null }
            }
          }
        }
        await writeSheet(file, sheet)
        writeJson(response, 200, { ok: true, data: await this.snapshot(file) })
        return
      }
      if (method === 'fetch') {
        const file = await this.resolveFile(body.file)
        const result = await tools.fetch.execute({
          file,
          cue_ids: Array.isArray(body.cueIds) ? body.cueIds : undefined,
          force: body.force === true
        }, exec)
        if (!result.ok) {
          writeJson(response, 200, { ok: false, error: { code: 'fetch-failed', message: result.hint || result.error || '检索失败' } })
          return
        }
        writeJson(response, 200, {
          ok: true,
          data: { filled: result.filled, insufficient: result.insufficient, errors: result.errors, quotaUsed: result.quotaUsed, next: result.next }
        })
        return
      }
      if (method === 'refetch-by-tag') {
        // A 路：整组匹配度都低时，用「模型认为最像的标签」当新查询词再搜一轮。
        // 关键是换词——原查询重复一遍只会拿回同一批歌。
        const file = await this.resolveFile(body.file)
        const sheet = await readSheet(file)
        const cue = sheet.cues.find((c) => c.id === String(body.cueId))
        if (!cue) throw new Error(`找不到段 ${String(body.cueId)}`)
        const counts = new Map()
        for (const candidate of cue.candidates ?? []) {
          const probs = candidate.analysis?.probs
          if (!probs) continue
          const topTag = Object.entries(probs).sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0]
          const word = topTag ? SEARCH_WORDS[topTag] : ''
          if (word) counts.set(word, (counts.get(word) ?? 0) + 1)
        }
        let query = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
        if (!query) query = SEARCH_WORDS[(cue.target ?? [])[0]?.tag] ?? ''
        if (!query) {
          writeJson(response, 200, { ok: false, error: { code: 'no-tags', message: '还没有可用的听感分析，先跑一次「分析听感」' } })
          return
        }
        cue.wants = [query, ...(Array.isArray(cue.wants) ? cue.wants : []).filter((w) => w !== query)].slice(0, 3)
        await writeSheet(file, sheet)
        const fetched = await tools.fetch.execute({ file, cue_ids: [cue.id], force: true }, exec)
        const tagged = await tools.tag.execute({ file, cue_ids: [cue.id], force: true, per_cue: 5 }, exec)
        writeJson(response, 200, {
          ok: true,
          data: { query, fetched: fetched?.filled ?? 0, analyzed: tagged?.analyzed ?? 0, sheet: await this.snapshot(file) }
        })
        return
      }
      if (method === 'pick') {
        const file = await this.resolveFile(body.file)
        const result = await tools.pick.execute({
          file,
          picks: [{
            cue_id: String(body.cueId ?? ''),
            primary: { song_id: Number(body.songId), why: String(body.why ?? '').slice(0, 30) },
            alts: Array.isArray(body.alts) ? body.alts : []
          }]
        }, exec)
        if (!result.ok) {
          writeJson(response, 200, { ok: false, error: { code: 'pick-rejected', message: (result.rejectedInputs ?? []).join('；') || result.error || '选曲被拒绝' } })
          return
        }
        writeJson(response, 200, { ok: true, data: await this.snapshot(file) })
        return
      }
      if (method === 'need-bgm') {
        const file = await this.resolveFile(body.file)
        const sheet = await readSheet(file)
        const cue = sheet.cues.find((c) => c.id === String(body.cueId))
        if (!cue) throw new Error(`找不到段 ${String(body.cueId)}`)
        cue.need_bgm = body.value !== false
        cue.state = cue.need_bgm ? 'ready' : 'skipped'
        await writeSheet(file, sheet)
        writeJson(response, 200, { ok: true, data: await this.snapshot(file) })
        return
      }
      if (method === 'history') {
        const list = await readHistory()
        const playlists = []
        for (const entry of list) {
          const exists = await fsp.stat(entry.file).then(() => true, () => false)
          playlists.push({ ...entry, exists })
        }
        const state = await readUiState()
        writeJson(response, 200, { ok: true, data: { playlists, recent: state.recent } })
        return
      }
      if (method === 'tag') {
        const file = await this.resolveFile(body.file)
        const result = await tools.tag.execute({
          file,
          cue_ids: Array.isArray(body.cueIds) ? body.cueIds : undefined,
          per_cue: Number(body.perCue) || 5,
          force: body.force === true
        }, exec)
        if (!result.ok) {
          writeJson(response, 200, { ok: false, error: { code: 'tag-failed', message: result.error || '听感分析失败' } })
          return
        }
        writeJson(response, 200, {
          ok: true,
          data: {
            analyzed: result.analyzed,
            cached: result.cached,
            tried: result.tried,
            failed: result.failed,
            remaining: result.remaining,
            partial: result.partial,
            stopReason: result.stopReason,
            sheet: await this.snapshot(file)
          }
        })
        return
      }
      if (method === 'playlist-preview') {
        const file = await this.resolveFile(body.file)
        const result = await tools.commit.execute({ file, dry_run: true }, exec)
        if (!result.ok) {
          writeJson(response, 200, { ok: false, error: { code: 'preview-failed', message: result.error ?? '无法预览' } })
          return
        }
        writeJson(response, 200, { ok: true, data: { playlist: result.playlist, added: result.added, total: result.total, missing: result.missing ?? [] } })
        return
      }
      if (method === 'commit') {
        const file = await this.resolveFile(body.file)
        const result = await tools.commit.execute({ file, dry_run: false }, exec)
        if (!result.ok) {
          writeJson(response, 200, { ok: false, error: { code: 'commit-failed', message: result.error ?? '建歌单失败' } })
          return
        }
        writeJson(response, 200, {
          ok: true,
          data: { playlist: result.playlist, playlistId: result.playlistId, added: result.added, total: result.total }
        })
        return
      }
      if (method === 'export') {
        const file = await this.resolveFile(body.file)
        const sheet = await readSheet(file)
        const paths = sheetPaths(file)
        await ncm.atomicWrite(paths.review, renderReview(sheet))
        await ncm.atomicWrite(paths.text, renderPlaylistText(sheet))
        await ncm.atomicWrite(paths.csv, renderPlaylistCsv(sheet))
        sheet.export = { at: new Date().toISOString(), tracks: sheet.cues.filter((c) => cueStatus(c) === 'picked').length }
        await writeSheet(file, sheet)
        writeJson(response, 200, { ok: true, data: { files: [paths.review, paths.text, paths.csv] } })
        return
      }
      if (method === 'settings') {
        if (body.set === true) {
          const clean = normalizeCookie(body.cookie ?? body.musicUCookie ?? '')
          // 存下来是一回事，能不能用是另一回事：过期时间写着 2027 也可能是死会话。
          // 先验证再落盘，顺便把昵称一起记下来给顶栏显示。
          const probe = clean === '' ? { valid: false, reason: 'empty' } : await probeCookie(clean)
          await saveCookie(clean, probe.nickname ?? '')
          writeJson(response, 200, {
            ok: true,
            data: {
              hasCookie: clean !== '',
              fields: clean === '' ? 0 : clean.split(';').length,
              valid: probe.valid === true,
              nickname: probe.nickname ?? '',
              reason: probe.reason ?? ''
            }
          })
          return
        }
        const cookie = await readCookie()
        writeJson(response, 200, { ok: true, data: { hasCookie: cookie !== '', fields: cookie === '' ? 0 : cookie.split(';').length } })
        return
      }
      if (method === 'vocal-setting') {
        // 人声识别设置：开关 + 扣减上限 penalty（0–0.6）+ 起罚线 threshold（0–0.95）
        const current = await readSettings()
        const prev = current.analysis?.vocal ?? {}
        const clamp = (value, min, max, fallback) => {
          const n = Number(value)
          if (!Number.isFinite(n)) return fallback
          return Math.min(max, Math.max(min, n))
        }
        const nextVocal = {
          ...prev,
          enabled: body.enabled === undefined ? prev.enabled !== false : body.enabled !== false,
          penalty: body.penalty === undefined
            ? clamp(prev.penalty, 0, 0.6, 0.4)
            : clamp(body.penalty, 0, 0.6, 0.4),
          threshold: body.threshold === undefined
            ? clamp(prev.threshold, 0, 0.95, 0.15)
            : clamp(body.threshold, 0, 0.95, 0.15)
        }
        const next = {
          ...current,
          analysis: { ...(current.analysis ?? {}), vocal: nextVocal }
        }
        await ncm.atomicWrite(path.join(ncm.dataDir(), 'settings.json'), JSON.stringify(next, null, 2))
        writeJson(response, 200, {
          ok: true,
          data: {
            vocalEnabled: nextVocal.enabled !== false,
            vocalPenalty: nextVocal.penalty,
            vocalThreshold: nextVocal.threshold
          }
        })
        return
      }
      if (method === 'avoid-setting') {
        // 负向标签总开关：关闭后打分不再乘惩罚，检索也不再用标题关键词筛
        const enabled = body.enabled !== false
        await writeSettings({ avoidEnabled: enabled })
        writeJson(response, 200, { ok: true, data: { avoidEnabled: enabled } })
        return
      }
      if (method === 'cookie-probe') {
        const target = typeof body.cookie === 'string' && body.cookie !== '' ? body.cookie : await readCookie()
        if (target === '') {
          writeJson(response, 200, { ok: true, data: { valid: false, reason: '还没设置' } })
          return
        }
        writeJson(response, 200, { ok: true, data: await probeCookie(target) })
        return
      }
      if (method === 'login-start') {
        const qr = await createQrLogin()
        const svg = await QRCode.toString(qr.url, { type: 'svg', margin: 1, width: 220, errorCorrectionLevel: 'M' })
        writeJson(response, 200, { ok: true, data: { key: qr.key, url: qr.url, svg } })
        return
      }
      if (method === 'login-poll') {
        const state = await pollQrLogin(String(body.key ?? ''))
        if (state.status !== 'ok') {
          writeJson(response, 200, { ok: true, data: { status: state.status, message: state.message ?? '' } })
          return
        }
        const probe = await probeCookie(state.cookie)
        if (probe.valid !== true) {
          writeJson(response, 200, { ok: false, error: { code: 'invalid', message: `扫码成功但账号校验失败：${probe.reason ?? '未知原因'}` } })
          return
        }
        await saveCookie(state.cookie, probe.nickname ?? '')
        writeJson(response, 200, {
          ok: true,
          data: { status: 'ok', nickname: probe.nickname ?? '', fields: state.cookie.split(';').length, hasCookie: true }
        })
        return
      }
      if (method === 'cookie-status') {
        const status = await chromeCookieStatus()
        if (status.valid) {
          const read = await readCookieFromChrome()
          if (read.ok) await saveCookie(read.cookie)
        }
        writeJson(response, 200, { ok: true, data: status })
        return
      }
      if (method === 'cookie-from-chrome') {
        const read = await readCookieFromChrome()
        if (!read.ok) {
          writeJson(response, 200, { ok: false, error: { code: 'chrome', message: read.error } })
          return
        }
        const probe = await probeCookie(read.cookie)
        if (probe.valid !== true) {
          writeJson(response, 200, {
            ok: false,
            error: { code: 'invalid', message: `Chrome 里的登录态服务端不认（${probe.reason ?? '会话失效'}）。用「登录网易云」扫码更稳。` }
          })
          return
        }
        await saveCookie(read.cookie, probe.nickname ?? '')
        writeJson(response, 200, { ok: true, data: { valid: true, nickname: probe.nickname ?? '', hasCookie: true, fields: read.fields ?? 0 } })
        return
      }
      if (method === 'cookie-clear') {
        await clearCookie()
        writeJson(response, 200, { ok: true, data: { hasCookie: false } })
        return
      }
      writeJson(response, 404, { ok: false, error: { code: 'unknown-method', message: `未知方法 ${method}` } })
    } catch (error) {
      this.logger?.warn?.(`bgm-prep ui: ${method} failed: ${String(error?.message ?? error)}`)
      writeJson(response, 200, { ok: false, error: { code: 'failed', message: String(error?.message ?? error) } })
    }
  }
}

export function writeJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body)
  })
  response.end(body)
}

function isLoopbackAddress(address) {
  const a = String(address).toLowerCase()
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'
}

function isLoopbackHostname(hostname) {
  const h = String(hostname).toLowerCase()
  return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]'
}

/** 只接受本机回环来源，和 /api 网关同样的姿态。 */
export function isTrusted(request) {
  const remote = request?.socket?.remoteAddress
  if (typeof remote === 'string' && !isLoopbackAddress(remote)) return false
  const host = request?.headers?.host
  if (typeof host !== 'string') return false
  let hostUrl
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (!isLoopbackHostname(hostUrl.hostname)) return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).hostname === hostUrl.hostname
  } catch {
    return false
  }
}










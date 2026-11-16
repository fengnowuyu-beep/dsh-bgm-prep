// 曲目表（cues）的读写、校验与派生状态。
// 唯一真相 = <模组目录>/bgm/<scope>.cues.json；人类看的是同名 .review.md。

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { atomicWrite } from './ncm.js'

export const SCHEMA = 1

export class SheetError extends Error {
  constructor(message, hint) {
    super(message)
    this.name = 'SheetError'
    this.hint = hint
  }
}

export function sheetPaths(file) {
  const dir = path.dirname(file)
  const base = path.basename(file).replace(/\.cues\.json$/, '').replace(/\.json$/, '')
  return {
    dir,
    base,
    sheet: path.join(dir, `${base}.cues.json`),
    review: path.join(dir, `${base}.review.md`),
    text: path.join(dir, `${base}.playlist.txt`),
    csv: path.join(dir, `${base}.playlist.csv`),
    source: path.join(dir, `${base}.source.md`)
  }
}

export function emptySheet({ module, session, scope }) {
  return {
    schema: SCHEMA,
    module: module ?? '',
    session: session ?? null,
    scope: scope ?? '',
    source: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    directives: [],
    cues: [],
    l1Shown: false,
    export: null
  }
}

export async function readSheet(file) {
  let raw
  try {
    raw = JSON.parse(await fsp.readFile(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new SheetError(`找不到曲目表：${file}`, '先用 bgm_init 创建，或确认 file 路径。')
    }
    throw new SheetError(`曲目表不是合法 JSON：${file}`, `原文件未改动。检查是否手改坏了；备份在同目录 *.bak-*。`)
  }
  return normalizeSheet(raw, file)
}

export async function writeSheet(file, sheet) {
  sheet.schema = SCHEMA
  sheet.updatedAt = new Date().toISOString()
  const json = JSON.stringify(sheet, null, 2)
  if (fs.existsSync(file)) {
    const bak = `${file}.bak-${stamp()}`
    await atomicWrite(bak, await fsp.readFile(file, 'utf8'))
    await pruneBackups(file, 3)
  }
  await atomicWrite(file, json)
  return sheet
}

export function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
}

async function pruneBackups(file, keep) {
  const dir = path.dirname(file)
  const base = path.basename(file)
  let entries = []
  try {
    entries = await fsp.readdir(dir)
  } catch {
    return
  }
  const baks = entries.filter((n) => n.startsWith(`${base}.bak-`)).sort().reverse()
  for (const old of baks.slice(keep)) {
    try { await fsp.unlink(path.join(dir, old)) } catch { /* ignore */ }
  }
}

export function normalizeSheet(raw, file) {
  if (!raw || typeof raw !== 'object') throw new SheetError(`曲目表内容不是对象：${file}`)
  if (!raw.scope) throw new SheetError(`曲目表缺少 scope 字段：${file}`)
  const cues = Array.isArray(raw.cues) ? raw.cues.map(normalizeCue) : []
  return {
    schema: SCHEMA,
    module: raw.module ?? '',
    session: raw.session ?? null,
    scope: raw.scope,
    source: raw.source ?? null,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
    directives: Array.isArray(raw.directives) ? raw.directives.filter((d) => d && d.text) : [],
    cues,
    l1Shown: raw.l1Shown === true,
    export: raw.export ?? null
  }
}

function normalizeCue(cue, index) {
  if (!cue || typeof cue !== 'object') throw new SheetError(`第 ${index + 1} 段不是对象`)
  const id = String(cue.id ?? `c${String(index + 1).padStart(2, '0')}`)
  if (!cue.scene || typeof cue.scene !== 'string') {
    throw new SheetError(`第 ${index + 1} 段（${id}）缺少 scene`)
  }
  return {
    id,
    scene: cue.scene,
    trigger: cue.trigger ?? '',
    need_bgm: cue.need_bgm !== false,
    state: cue.state === 'skipped' || cue.state === 'insufficient' ? cue.state : 'ready',
    tags: cue.tags ?? null,
    wants: Array.isArray(cue.wants) ? cue.wants : [],
    avoids: Array.isArray(cue.avoids) ? cue.avoids : [],
    candidates: Array.isArray(cue.candidates) ? cue.candidates : [],
    picks: cue.picks ?? null,
    rejected: Array.isArray(cue.rejected) ? cue.rejected : [],
    note: cue.note ?? ''
  }
}

/** 派生状态：不落盘，避免两处真相漂移。 */
export function cueStatus(cue) {
  if (!cue.need_bgm) return 'skipped'
  if (cue.picks?.primary?.song_id) return 'picked'
  if (cue.state === 'insufficient') return 'insufficient'
  if (cue.candidates.length > 0) return 'candidates'
  return 'ready'
}

export function summarize(sheet) {
  const stats = { total: sheet.cues.length, skipped: 0, picked: 0, candidates: 0, ready: 0, insufficient: 0 }
  for (const cue of sheet.cues) {
    const s = cueStatus(cue)
    stats[s] = (stats[s] ?? 0) + 1
  }
  return stats
}

/** 校验一批待写入的 cue 定义。返回 { ok, errors, warnings }。 */
export function validateCueInputs(cues) {
  const errors = []
  const warnings = []
  if (!Array.isArray(cues) || cues.length === 0) {
    errors.push('cues 必须是非空数组')
    return { ok: false, errors, warnings }
  }
  const seen = new Set()
  cues.forEach((cue, i) => {
    const n = i + 1
    if (!cue || typeof cue !== 'object') { errors.push(`第 ${n} 段不是对象`); return }
    if (!cue.scene || typeof cue.scene !== 'string' || !cue.scene.trim()) errors.push(`第 ${n} 段缺少 scene`)
    if (cue.id) {
      if (seen.has(cue.id)) errors.push(`第 ${n} 段的 id「${cue.id}」重复`)
      seen.add(cue.id)
    }
  })
  const need = cues.filter((c) => c && c.need_bgm !== false).length
  if (need === 0) warnings.push('所有段都标成了不配乐，歌单会是空的')
  return { ok: errors.length === 0, errors, warnings }
}

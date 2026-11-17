// 听感分析的持久库（SQLite，Node 内置 node:sqlite）。
//
// 目的：一首歌分析一次，之后任何曲目表、任何会话都直接复用。
// 位置：$DSH_HOME/bgm-prep/analysis.db
// 键：song_id + engine（engine 带词表/模型版本，换版本不会串味）。

import fs from 'node:fs'
import path from 'node:path'
import * as ncm from './ncm.js'

let dbPromise = null
let logger = null
let lastError = ''
const loggedErrors = new Set()

/** 由插件入口把 ctx.logger 接进来；没有就退回 console.debug。 */
export function setAnalysisLogger(next) {
  logger = next ?? null
}

/** 最近一次库错误（打开/读/写都算）。给上层区分「库不可用」和「写失败」用。 */
export function dbError() {
  return lastError
}

function noteError(where, error) {
  const message = `${where}：${error?.message ?? String(error)}`
  lastError = message
  if (loggedErrors.has(message)) return
  loggedErrors.add(message)
  try {
    if (typeof logger?.debug === 'function') logger.debug(`[bgm-prep] analysis.db ${message}`)
    else console.debug?.(`[bgm-prep] analysis.db ${message}`)
  } catch { /* 记日志失败不该影响主流程 */ }
}

export function dbFile() {
  return path.join(ncm.dataDir(), 'analysis.db')
}

async function openDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      try {
        fs.mkdirSync(ncm.dataDir(), { recursive: true })
        const { DatabaseSync } = await import('node:sqlite')
        const db = new DatabaseSync(dbFile())
        db.exec(`
          CREATE TABLE IF NOT EXISTS analysis (
            song_id   INTEGER NOT NULL,
            engine    TEXT    NOT NULL,
            probs     TEXT,
            va        TEXT,
            vocal     REAL,
            stability REAL,
            at        TEXT,
            PRIMARY KEY (song_id, engine)
          )
        `)
        return db
      } catch (error) {
        noteError('不可用', error)
        return null
      }
    })()
  }
  return dbPromise
}

/** 数据库是否可用（node:sqlite 在 Node 22.5+ 可用）。 */
export async function available() {
  return (await openDb()) !== null
}

/** 读一条分析结果；没有返回 null。 */
export async function readAnalysis(songId, engine) {
  const db = await openDb()
  if (!db) return null
  try {
    const row = db
      .prepare('SELECT probs, va, vocal, stability, at FROM analysis WHERE song_id = ? AND engine = ?')
      .get(Number(songId), String(engine))
    if (!row) return null
    return {
      probs: row.probs ? JSON.parse(row.probs) : null,
      va: row.va ? JSON.parse(row.va) : null,
      vocal: row.vocal ?? null,
      stability: row.stability ?? null,
      engine: String(engine),
      at: row.at ?? ''
    }
  } catch (error) {
    noteError('读取失败', error)
    return null
  }
}

/** 写一条分析结果（存在则覆盖）。 */
export async function writeAnalysis(songId, engine, payload) {
  const db = await openDb()
  if (!db) return false
  try {
    db.prepare(`
      INSERT INTO analysis (song_id, engine, probs, va, vocal, stability, at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(song_id, engine) DO UPDATE SET
        probs = excluded.probs,
        va = excluded.va,
        vocal = excluded.vocal,
        stability = excluded.stability,
        at = excluded.at
    `).run(
      Number(songId),
      String(engine),
      payload.probs ? JSON.stringify(payload.probs) : null,
      payload.va ? JSON.stringify(payload.va) : null,
      payload.vocal ?? null,
      payload.stability ?? null,
      payload.at ?? new Date().toISOString()
    )
    return true
  } catch (error) {
    noteError('写入失败', error)
    return false
  }
}

/** 库里有多少条（可选的健康检查/汇报用）。 */
export async function countAnalysis() {
  const db = await openDb()
  if (!db) return 0
  try {
    const row = db.prepare('SELECT COUNT(1) AS n FROM analysis').get()
    return Number(row?.n ?? 0)
  } catch (error) {
    noteError('计数失败', error)
    return 0
  }
}

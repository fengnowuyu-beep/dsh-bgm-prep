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
        // 失败负缓存：同一首拿不到音频的歌，不要在每次 bgm_tag 里重来一遍。
        // 记次数 + 冷却时间；冷却期内的歌直接跳过，不再花 3 分钟去等它超时。
        db.exec(`
          CREATE TABLE IF NOT EXISTS analysis_failures (
            song_id     INTEGER NOT NULL,
            engine      TEXT    NOT NULL,
            attempts    INTEGER NOT NULL DEFAULT 0,
            reason      TEXT,
            last_at     TEXT,
            retry_after TEXT,
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

/** 只补人声概率，不动 probs/va（给存量分析做人声回填用）。 */
export async function updateVocal(songId, engine, vocal) {
  const db = await openDb()
  if (!db) return false
  try {
    db.prepare('UPDATE analysis SET vocal = ? WHERE song_id = ? AND engine = ?')
      .run(vocal === null || vocal === undefined ? null : Number(vocal), Number(songId), String(engine))
    return true
  } catch (error) {
    noteError('写入人声失败', error)
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

// ---------------------------------------------------------------- 失败负缓存

/** 失败几次之后进冷却、冷却多久。 */
export const FAILURE_POLICY = { cooldownAfter: 2, cooldownMs: 10 * 60 * 1000 }

/** 读一条失败记录；没有返回 null。库不可用时返回 null（等于不做负缓存）。 */
export async function readFailure(songId, engine) {
  const db = await openDb()
  if (!db) return null
  try {
    const row = db
      .prepare('SELECT attempts, reason, last_at, retry_after FROM analysis_failures WHERE song_id = ? AND engine = ?')
      .get(Number(songId), String(engine))
    if (!row) return null
    return {
      attempts: Number(row.attempts ?? 0),
      reason: row.reason ?? '',
      lastAt: row.last_at ?? '',
      retryAfter: row.retry_after ?? ''
    }
  } catch (error) {
    noteError('读失败记录出错', error)
    return null
  }
}

/**
 * 记一次失败。达到门槛就写冷却截止时间。
 * @returns {{attempts:number, retryAfter:string}}
 */
export async function recordFailure(songId, engine, reason, policy = FAILURE_POLICY) {
  const db = await openDb()
  if (!db) return { attempts: 0, retryAfter: '' }
  const now = new Date()
  try {
    const prev = await readFailure(songId, engine)
    const attempts = (prev?.attempts ?? 0) + 1
    const cooling = attempts >= policy.cooldownAfter
    const retryAfter = cooling ? new Date(now.getTime() + policy.cooldownMs).toISOString() : ''
    db.prepare(`
      INSERT INTO analysis_failures (song_id, engine, attempts, reason, last_at, retry_after)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(song_id, engine) DO UPDATE SET
        attempts = excluded.attempts,
        reason = excluded.reason,
        last_at = excluded.last_at,
        retry_after = excluded.retry_after
    `).run(Number(songId), String(engine), attempts, String(reason ?? '').slice(0, 120), now.toISOString(), retryAfter)
    return { attempts, retryAfter }
  } catch (error) {
    noteError('写失败记录出错', error)
    return { attempts: 0, retryAfter: '' }
  }
}

/** 分析成功后清掉失败记录，下次照常尝试。 */
export async function clearFailure(songId, engine) {
  const db = await openDb()
  if (!db) return false
  try {
    db.prepare('DELETE FROM analysis_failures WHERE song_id = ? AND engine = ?').run(Number(songId), String(engine))
    return true
  } catch (error) {
    noteError('清失败记录出错', error)
    return false
  }
}

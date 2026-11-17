// 词表：music2emo 的原生标签（MTG-Jamendo mood/theme）。
//
// 设计原则（v4.3）：不做中文转写、不做二次映射。模型认识哪些词，场景就用哪些词。
// 唯一真相是安装时从模型里抄出来的 tag_list —— 落在 $DSH_HOME/bgm-prep/moods.json。
// 这里的 FALLBACK_TAGS 只用于开发与首次安装前的占位；`loadTags()` 读到用户文件时以文件为准。

import fsp from 'node:fs/promises'
import path from 'node:path'
import * as ncm from './ncm.js'

/**
 * music2emo 的实际标签集：MTG-Jamendo 的 56 个 mood/theme（取 `tag_list.npy[127:]`）。
 */
export const FALLBACK_TAGS = [
  'action', 'adventure', 'advertising', 'background', 'ballad', 'calm',
  'children', 'christmas', 'commercial', 'cool', 'corporate', 'dark',
  'deep', 'documentary', 'drama', 'dramatic', 'dream', 'emotional',
  'energetic', 'epic', 'fast', 'film', 'fun', 'funny', 'game', 'groovy',
  'happy', 'heavy', 'holiday', 'hopeful', 'inspiring', 'love', 'meditative',
  'melancholic', 'melodic', 'motivational', 'movie', 'nature', 'party',
  'positive', 'powerful', 'relaxing', 'retro', 'romantic', 'sad', 'sexy',
  'slow', 'soft', 'soundscape', 'space', 'sport', 'summer', 'trailer',
  'travel', 'upbeat', 'uplifting'
]

/**
 * 读实际生效的词表。
 * $DSH_HOME/bgm-prep/moods.json 形如：
 *   { "version": "music2emo-2026-11-18", "tags": ["horror", "dark", ...] }
 * 缺文件时用 FALLBACK_TAGS（并标 version=fallback，便于 UI 提示）。
 * @returns {Promise<{version: string, tags: string[], fromFile: boolean}>}
 */
export async function loadTags() {
  const file = path.join(ncm.dataDir(), 'moods.json')
  try {
    const raw = JSON.parse(await fsp.readFile(file, 'utf8'))
    const tags = normalizeTagList(raw?.tags ?? raw)
    if (tags.length === 0) throw new Error('empty')
    return { version: String(raw?.version ?? 'custom'), tags, fromFile: true }
  } catch {
    return { version: 'fallback', tags: [...FALLBACK_TAGS], fromFile: false }
  }
}

/** 去重、去空、统一小写；保留首次出现的顺序。 */
export function normalizeTagList(list) {
  const out = []
  const seen = new Set()
  for (const item of Array.isArray(list) ? list : []) {
    const name = String(typeof item === 'string' ? item : item?.tag ?? '')
      .replace(/^mood\/theme---/, '')
      .trim()
      .toLowerCase()
    if (name === '' || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

/** 写入词表（安装时用：从 tag_list.npy 抄出来冻结）。 */
export async function saveTags(tags, version = 'music2emo') {
  const list = normalizeTagList(tags)
  if (list.length === 0) throw new Error('词表为空')
  const file = path.join(ncm.dataDir(), 'moods.json')
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await fsp.writeFile(file, JSON.stringify({ version, tags: list }, null, 2) + '\n', 'utf8')
  return { version, tags: list }
}

/** 「22 个真情绪」子集：用途词（corporate/trailer/…）对跑团无意义，选目标时默认不展示。 */
export const USAGE_TAGS = new Set([
  'advertising', 'commercial', 'corporate', 'documentary', 'drama', 'film',
  'game', 'holiday', 'christmas', 'children', 'movie', 'trailer', 'travel',
  'summer', 'sport', 'party', 'background', 'sexy', 'nature', 'retro'
])

export function isUsageTag(tag) {
  return USAGE_TAGS.has(String(tag).toLowerCase())
}

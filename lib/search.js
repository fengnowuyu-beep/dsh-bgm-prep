// 候选检索：以「歌曲搜索」为主，种子歌单为辅。
// 登录后 ncm-cli 会注册 search / playlist 动态命令，这两个能力在开放平台 HTTP
// 接口上被应用权限挡死了（300），所以数据类操作统一走 CLI（见 lib/ncm.js）。

import * as ncm from './ncm.js'

const AUTH_CODES = new Set(['300', '301', '1406', '1407', '1408', '2509', 'cli-not-logged-in'])

// 情绪检索词：单字/单词最有效。场景名不进检索（"码头"会搜出网络神曲）。
const MOOD_BY_ENERGY = {
  static: { dark: '压抑', neutral: '安静', bright: '治愈' },
  building: { dark: '悬疑', neutral: '紧张', bright: '希望' },
  driving: { dark: '追逐', neutral: '激燃', bright: '冒险' },
  burst: { dark: '史诗 战斗', neutral: '战斗', bright: '热血' }
}

// 织体只用于打分，不进检索词（多一个词，召回掉一个量级）
const SCENE_HINTS = [
  ['酒馆', '酒馆 民谣'], ['森林', '森林 神秘'], ['地城', '地城 冒险'],
  ['地下', '地下 阴森'], ['海洋', '航海 冒险'], ['海港', '航海'], ['教堂', '教堂 圣歌'],
  ['宫殿', '宫廷 宏大'], ['废墟', '废墟 荒凉'], ['雪原', '雪原 寒冷'], ['战场', '战场 史诗'],
  ['集市', '市集 轻松'], ['书房', '静谧 阅读'], ['实验室', '诡异 机械']
]

const TEXTURE_WORDS = {
  drone: '氛围',
  strings: '弦乐',
  piano: '钢琴',
  percussion: '打击',
  synth: '电子',
  choir: '合唱',
  folk: '民族'
}

/** 由标签拼检索词。只按演出功能检索，且控制在一两个词以内。 */
export function buildQueries(cue) {
  const tags = cue.tags ?? {}
  const energy = MOOD_BY_ENERGY[tags.energy] ? tags.energy : 'static'
  const valence = tags.valence && MOOD_BY_ENERGY[energy][tags.valence] ? tags.valence : 'neutral'
  const mood = MOOD_BY_ENERGY[energy][valence]
  const texture = Array.isArray(tags.texture) && tags.texture.length > 0
    ? (TEXTURE_WORDS[tags.texture[0]] ?? '')
    : ''

  // 用户/agent 明确写了想要的风格时，优先按它搜（爵士、圣歌这类按情绪词搜不出来）
  const wanted = Array.isArray(cue.wants) && cue.wants.length > 0 ? String(cue.wants[0]).trim() : ''
  const queries = []
  if (wanted) queries.push(wanted)
  queries.push(`${mood} 纯音乐`)
  if (!wanted) queries.push(texture ? `${mood} ${texture}` : `${mood} OST`)

  const scene = String(cue.scene ?? '')
  for (const [key, hint] of SCENE_HINTS) {
    if (scene.includes(key)) {
      queries.push(`${hint} 纯音乐`)
      break
    }
  }
  return [...new Set(queries)].slice(0, 3)
}

/**
 * 为一个 cue 收集原始曲目（未过滤）。
 * @returns {{tracks: object[], usedSeed: number, queries: string[], notes: string[]}}
 */
export async function collectForCue(cue, { baseTracks = [], seedPlaylists = [], budget = { left: 40 } } = {}) {
  const notes = []
  const tags = cue.tags ?? {}
  const energy = MOOD_BY_ENERGY[tags.energy] ? tags.energy : 'static'
  const valence = tags.valence && MOOD_BY_ENERGY[energy][tags.valence] ? tags.valence : 'neutral'
  const mood = MOOD_BY_ENERGY[energy][valence]
  const queries = buildQueries(cue)
  const tracks = [...baseTracks]
  let usedSeed = 0

  // 种子歌单由调用方一次性读好传进来（baseTracks），这里只补"自己传 id"的情况
  if (baseTracks.length === 0) {
    for (const playlistId of seedPlaylists.slice(0, 2)) {
      if (budget.left <= 0) break
      try {
        tracks.push(...await ncm.playlistTracks(playlistId, { limit: 200 }))
        budget.left -= 1
        usedSeed += 1
      } catch (error) {
        budget.left -= 1
        if (AUTH_CODES.has(String(error.code))) throw error
        notes.push(`读种子歌单 ${playlistId} 失败：${error.message}`)
      }
    }
  }

  // 每个场景都要有一次"自己的"检索，否则所有段落会拿到同一批候选。
  // 有 wants 就按风格搜歌单（"1920年代 爵士"能直接命中爵士精选），
  // 没有就按情绪搜跑团歌单 —— 搜歌对"爵士""管风琴"这类词几乎无用，歌单才有用。
  const want = Array.isArray(cue.wants) && cue.wants.length > 0 ? String(cue.wants[0]).trim() : ''
  const playlistQueries = want
    ? [want, `${mood} 跑团 BGM`]
    : [`${mood} 跑团 BGM`, `${mood} 纯音乐`]
  for (const keyword of playlistQueries) {
    if (budget.left <= 0) break
    try {
      const found = await ncm.searchPlaylistsCli(keyword, { limit: 6 })
      budget.left -= 1
      const targets = found
        .filter((p) => Number(p.trackCount ?? 0) >= 10)
        .filter((p) => !/华语|日系|ACG|其他|喜欢/.test(String(p.name)))
        .slice(0, 2)
      for (const target of targets) {
        if (budget.left <= 0) break
        try {
          const list = await ncm.playlistTracks(target.id, { limit: 100 })
          tracks.push(...list.map((t) => ({ ...t, source: target.name })))
          budget.left -= 1
        } catch (error) {
          budget.left -= 1
          if (AUTH_CODES.has(String(error.code))) throw error
          notes.push(`读歌单「${target.name}」失败`)
        }
      }
      if (tracks.length >= 40) break
    } catch (error) {
      budget.left -= 1
      if (AUTH_CODES.has(String(error.code))) throw error
      notes.push(`搜歌单「${keyword}」失败：${error.message}`)
    }
  }

  // 再补一次歌曲搜索，让不同情绪拿到不同曲目
  if (budget.left > 0) {
    try {
      tracks.push(...await ncm.searchSongs(queries[0], { limit: 40 }))
      budget.left -= 1
    } catch (error) {
      budget.left -= 1
      if (AUTH_CODES.has(String(error.code))) throw error
      notes.push(`搜「${queries[0]}」失败：${error.message}`)
    }
  }

  if (tracks.length === 0) notes.push('这个场景没搜到任何曲子')
  return { tracks, usedSeed, queries, notes }
}

/** 一次性读出种子歌单的全部曲目，供所有 cue 共用。 */
export async function loadSeedTracks(seedPlaylists, budget) {
  const tracks = []
  for (const id of seedPlaylists.slice(0, 2)) {
    if (budget && budget.left <= 0) break
    try {
      const list = await ncm.playlistTracks(id, { limit: 200 })
      tracks.push(...list.map((t) => ({ ...t, source: '我的种子歌单' })))
      if (budget) budget.left -= 1
    } catch { /* 种子读不到不影响主流程 */ }
  }
  return tracks
}

/** 从任意嵌套返回里挖出曲目数组（保留：接口形状变化时的兜底）。 */
export function extractTracks(data) {
  const seen = new Set()
  const out = []
  const visit = (node, depth) => {
    if (!node || depth > 4 || seen.has(node)) return
    if (Array.isArray(node)) {
      for (const item of node) {
        if (item && typeof item === 'object' && ('songId' in item || 'originalId' in item || 'id' in item)
          && ('songName' in item || 'name' in item)) {
          out.push(item)
        } else {
          visit(item, depth + 1)
        }
      }
      return
    }
    if (typeof node === 'object') {
      seen.add(node)
      for (const value of Object.values(node)) visit(value, depth + 1)
    }
  }
  visit(data, 0)
  return out
}

/** 从搜索结果里挖出歌单数组。 */
export function extractPlaylists(data) {
  const seen = new Set()
  const out = []
  const visit = (node, depth) => {
    if (!node || depth > 4 || seen.has(node)) return
    if (Array.isArray(node)) {
      for (const item of node) {
        if (item && typeof item === 'object' && (item.id || item.playlistId) && (item.name || item.playlistName || item.title)) {
          out.push({
            id: String(item.id ?? item.playlistId),
            name: String(item.name ?? item.playlistName ?? item.title),
            trackCount: Number(item.trackCount ?? item.songCount ?? item.size ?? 0),
            creator: String(item.creatorNickName ?? '')
          })
        } else {
          visit(item, depth + 1)
        }
      }
      return
    }
    if (typeof node === 'object') {
      seen.add(node)
      for (const value of Object.values(node)) visit(value, depth + 1)
    }
  }
  visit(data, 0)
  return out.filter((p) => p.id && p.id !== '0' && p.id !== 'undefined' && p.id !== 'NaN')
}



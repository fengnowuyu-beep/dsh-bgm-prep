// 候选检索：歌单搜索为主（氛围召回），歌曲搜索补量。
// 检索词是中文（网易云曲库），但**打分用的是 music2emo 的原生标签**——
// 两边刻意不共用一套词：检索要中文，打分要模型认识的英文标签。

import * as ncm from './ncm.js'
import { matchMoodKeyword } from './filter.js'
import { targetTags } from './target.js'

const AUTH_CODES = new Set(['300', '301', '1406', '1407', '1408', '2509', 'cli-not-logged-in'])

// 原生标签 → 中文检索词。**必须覆盖 moods.json 的全部 56 个标签**
// （test/optimizations.test.mjs 会校验），否则某段拿 deep 之类做主干时会退化成「氛围」。
export const SEARCH_WORDS = {
  action: '战斗', adventure: '冒险', advertising: '广告', background: '背景',
  ballad: '叙事', calm: '安静', children: '童趣', christmas: '圣诞',
  commercial: '商业', cool: '酷炫', corporate: '商务', dark: '黑暗',
  deep: '深沉', documentary: '记录', drama: '剧情', dramatic: '紧张',
  dream: '梦幻', emotional: '情感', energetic: '激烈', epic: '史诗',
  fast: '快速', film: '电影', fun: '有趣', funny: '滑稽',
  game: '游戏', groovy: '律动', happy: '欢快', heavy: '沉重',
  holiday: '节日', hopeful: '希望', inspiring: '励志', love: '爱情',
  meditative: '冥想', melancholic: '忧伤', melodic: '旋律', motivational: '激励',
  movie: '影视', nature: '自然', party: '派对', positive: '积极', powerful: '宏大',
  relaxing: '放松', retro: '复古', romantic: '浪漫', sad: '悲伤',
  sexy: '性感', slow: '缓慢', soft: '温柔', soundscape: '氛围',
  space: '太空', sport: '运动', summer: '夏日', trailer: '预告',
  travel: '旅行', upbeat: '轻快', uplifting: '昂扬'
}

// 这些标签描述的是「用途/受众」而不是听感，拿去做网易云检索词只会召回成品广告配乐。
// 有别的标签可用时先跳过它们，实在只剩它们才退回。
const LOW_SIGNAL_WORDS = new Set(['advertising', 'commercial', 'corporate', 'background', 'sport', 'documentary'])

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

/** 目标标签 → 中文检索词；跳过低区分度标签，取权重最高的两个。 */
export function searchWords(cue) {
  const tags = targetTags(cue?.target)
  const mapped = tags.map((tag) => ({ tag, word: SEARCH_WORDS[tag] })).filter((x) => x.word)
  const strong = mapped.filter((x) => !LOW_SIGNAL_WORDS.has(x.tag))
  const use = strong.length > 0 ? strong : mapped
  return use.slice(0, 2).map((x) => x.word)
}

/** 这段可用的检索词：先 wants（最多两条），再按目标标签拼。 */
export function wantedQueries(cue) {
  return (Array.isArray(cue?.wants) ? cue.wants : [])
    .map((w) => String(w ?? '').trim())
    .filter(Boolean)
    .slice(0, 2)
}

/** 由目标标签拼检索词。只按演出功能检索，且控制在一两个词以内。 */
export function buildQueries(cue) {
  const words = searchWords(cue)
  const mood = words[0] ?? '氛围'
  const texture = Array.isArray(cue?.tags?.texture) && cue.tags.texture.length > 0
    ? (TEXTURE_WORDS[cue.tags.texture[0]] ?? '')
    : ''

  // 用户/agent 明确写了想要的风格时，优先按它搜（爵士、圣歌这类按情绪词搜不出来）。
  // 最多两条：再多的词基本不会多召回一倍的池子，只会白烧调用预算。
  const queries = [...wantedQueries(cue)]
  queries.push(`${mood} 纯音乐`)
  if (queries.length < 2) queries.push(texture ? `${mood} ${texture}` : `${mood} OST`)

  const scene = String(cue.scene ?? '')
  for (const [key, hint] of SCENE_HINTS) {
    if (scene.includes(key)) {
      queries.push(`${hint} 纯音乐`)
      break
    }
  }
  return [...new Set(queries)].slice(0, 3)
}

/** 种子池按需补位：只有本段自己的池子不够时，才用情绪关键词从种子歌单里挑几首。 */
export const SEED_TOPPING = { threshold: 12, take: 4 }

export function pickSeedTopping(seedTracks, cue, { take = SEED_TOPPING.take } = {}) {
  if (!Array.isArray(seedTracks) || seedTracks.length === 0) return []
  const out = []
  for (const track of seedTracks) {
    if (out.length >= take) break
    if (out.some((t) => t.song_id === track.song_id)) continue
    // 只在标题/艺人/专辑里能对上一段情绪词时才补，避免把收藏夹里的无关曲目塞进来
    if (!matchMoodKeyword(track, cue?.tags ?? {})) continue
    out.push(track)
  }
  return out
}

/**
 * 为一个 cue 收集原始曲目（未过滤）。
 * 种子池**不再无条件注入每一段**（那会让收藏夹里的无关曲目铺满全表），
 * 只在「本段自己的池子不足 SEED_TOPPING.threshold 首」时按情绪词补几首。
 * @returns {{tracks: object[], usedSeed: number, queries: string[], notes: string[]}}
 */
export async function collectForCue(cue, {
  baseTracks = [], seedPlaylists = [], seedProvider = null, budget = { left: 40 }
} = {}) {
  const notes = []
  const mood = searchWords(cue)[0] ?? '氛围'
  const queries = buildQueries(cue)
  const tracks = []
  let usedSeed = 0

  // 每个场景都要有一次"自己的"检索，否则所有段落会拿到同一批候选。
  // 有 wants 就按风格搜歌单（"1920年代 爵士"能直接命中爵士精选），
  // 没有就按情绪搜跑团歌单 —— 搜歌对"爵士""管风琴"这类词几乎无用，歌单才有用。
  // wants 现在是**前两条都生效**：一条词只能召回一个方向，两条能覆盖"氛围 + 风格"。
  const wants = wantedQueries(cue)
  const playlistQueries = wants.length > 0
    ? [...wants, `${mood} 纯音乐`]
    : [`${mood} 跑团 BGM`, `${mood} 纯音乐`]

  // 搜歌和搜歌单彼此独立，串行只是白等两次网络，所以这里把搜歌先全部发出去。
  // 结果等歌单那一段跑完再收，曲目次序和原来一样（歌单在前、搜歌在后）。
  // 代价：并发之后没法中途按结果早停，预算只能一次预留。
  const songTasks = []
  for (const query of queries.slice(0, 2)) {
    if (budget.left <= 0) break
    budget.left -= 1
    songTasks.push(
      ncm.searchSongs(query, { limit: 40 }).then(
        (hits) => ({ query, hits }),
        (error) => ({ query, hits: [], error })
      )
    )
  }

  for (const keyword of playlistQueries) {
    if (budget.left <= 0) break
    budget.left -= 1
    try {
      const found = await ncm.searchPlaylistsCli(keyword, { limit: 6 })
      const targets = found
        .filter((p) => Number(p.trackCount ?? 0) >= 10)
        .filter((p) => !/华语|日系|ACG|其他|喜欢/.test(String(p.name)))
        .slice(0, 2)
      // 同一个关键词命中的两个歌单互不依赖：并发读，省掉一次等网络的时间
      const lists = await Promise.all(targets.map((target) => {
        if (budget.left <= 0) return Promise.resolve(null)
        budget.left -= 1
        return ncm.playlistTracks(target.id, { limit: 100 }).then(
          (list) => ({ target, list }),
          (error) => ({ target, list: [], error })
        )
      }))
      for (const item of lists) {
        if (!item) continue
        if (item.error) {
          if (AUTH_CODES.has(String(item.error.code))) throw item.error
          notes.push(`读歌单「${item.target.name}」失败`)
          continue
        }
        tracks.push(...item.list.map((t) => ({ ...t, source: item.target.name, origin: 'playlist' })))
      }
      if (tracks.length >= 40) break
    } catch (error) {
      if (AUTH_CODES.has(String(error.code))) throw error
      notes.push(`搜歌单「${keyword}」失败：${error.message}`)
    }
  }

  // 收搜歌结果。鉴权类错误要往上抛：那意味着整条 CLI 通道都不通了。
  for (const task of await Promise.all(songTasks)) {
    if (task.error) {
      if (AUTH_CODES.has(String(task.error.code))) throw task.error
      notes.push(`搜「${task.query}」失败：${task.error.message}`)
      continue
    }
    // 标上来源：搜歌结果不带出歌单名，不标的话工作台「来源」一列是空的，没法复核
    tracks.push(...task.hits.map((t) => ({ ...t, source: `歌曲搜索：${task.query}`, origin: 'search' })))
  }

  // 池子不够才动种子歌单，且只补能对上本段情绪的几首。
  if (tracks.length < SEED_TOPPING.threshold) {
    let seedPool = Array.isArray(baseTracks) ? baseTracks : []
    if (seedPool.length === 0 && typeof seedProvider === 'function') {
      try {
        seedPool = await seedProvider()
      } catch (error) {
        if (AUTH_CODES.has(String(error.code))) throw error
        notes.push(`读种子歌单失败：${error.message}`)
      }
    }
    const topping = pickSeedTopping(seedPool, cue)
    if (topping.length > 0) {
      tracks.push(...topping.map((t) => ({ ...t, origin: 'seed', source: t.source ?? '我的种子歌单' })))
      usedSeed = topping.length
      notes.push(`本段池子只有 ${tracks.length - topping.length} 首，从种子歌单补了 ${topping.length} 首`)
    }
  }

  if (tracks.length === 0) notes.push('这个场景没搜到任何曲子')
  return { tracks, usedSeed, queries, notes }
}

/** 一次性读出种子歌单的全部曲目，供所有 cue 共用。 */
export async function loadSeedTracks(seedPlaylists, budget) {
  const ids = seedPlaylists.slice(0, 2)
  // 两个种子歌单互不依赖，并发读；预算按原语义算「成功读到几个」。
  const allowed = budget ? Math.max(0, Math.min(ids.length, budget.left)) : ids.length
  const results = await Promise.all(
    ids.slice(0, allowed).map((id) => ncm.playlistTracks(id, { limit: 200 }).then((list) => list, () => null))
  )
  const tracks = []
  for (const list of results) {
    if (!list) continue
    if (budget) budget.left -= 1
    tracks.push(...list.map((t) => ({ ...t, source: '我的种子歌单', origin: 'seed' })))
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



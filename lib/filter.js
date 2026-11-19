// 候选曲目的归一化、去噪、去重与打分。纯函数，无 I/O。

const NOISE = [
  /(?:^|[\s(（[-])(live|现场版|演唱会)(?:$|[\s)）\]])/i,
  /翻唱|cover(?!\s*art)/i,
  /remix|混音版|dj版/i,
  /伴奏(?:版)?/i,
  /片段|试听|铃声|抖音|剪辑/i,
  /钢琴版|吉他版|八音盒|音乐盒/i,
  // 这些在 2026-11-19 的实跑里真的进了候选头部（关键词分 12 排第一）：
  // 做伴奏用的 type beat、变速版、夜核、卡拉 OK、8D 音效版——都不是能配乐的曲子。
  /type\s*beat|beat\s*type/i,
  /\(?\s*(sped\s*up|speed\s*up|slowed(\s*\+\s*reverb)?|nightcore|加速版|减速版)\s*\)?/i,
  /karaoke|卡拉\s*ok|伴奏曲/i,
  /8d\s*audio|mashup|翻自|原唱版$/i
]

const CLEAN_HINT = /(纯音乐|instrumental|ost|原声|bgm)/i

export function isNoise(title) {
  if (!title) return true
  return NOISE.some((re) => re.test(title))
}

function firstString(...candidates) {
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function joinArtists(value) {
  if (!value) return ''
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) {
    return value
      .map((a) => (typeof a === 'string' ? a : a?.name ?? a?.artistName ?? ''))
      .filter(Boolean)
      .join(' / ')
  }
  return firstString(value.name, value.artistName)
}

function normalizeDuration(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n > 10000 ? Math.round(n / 1000) : Math.round(n)
}

/** 把开放平台/CLI 里可能出现的各种字段名统一成一个形状。 */
export function normalizeTrack(raw) {
  if (!raw || typeof raw !== 'object') return null
  // CLI 的记录里 originalId 是数字 id，id 是 32 位加密 id（加歌单时要它）
  const encrypted = typeof raw.id === 'string' && /^[0-9A-Fa-f]{32}$/.test(raw.id) ? raw.id : undefined
  let numeric = NaN
  for (const candidate of [
    raw.originalId, raw.songId, raw.song_id, raw.trackId, raw.resourceId,
    typeof raw.id === 'number' ? raw.id : undefined
  ]) {
    const n = Number(candidate)
    if (Number.isFinite(n) && n > 0) { numeric = n; break }
  }
  const songId = Number.isFinite(numeric) ? numeric : Number(raw.id)
  if (!Number.isFinite(songId) || songId <= 0) return null
  // 可播性只看**硬信号**。
  // 以前这里写的是 `if (raw.playFlag === false) return null`，但 ncm-cli 的 playFlag
  // 在歌单曲目上大面积是 false（实测 173 首里 131 首），抽 3 首去换直链全都有 URL，
  // 而且 maxBr=999000 无损可播——等于用这个字段把 76% 的池子直接扔了。
  // 真正的不可播信号：版权下架、试听限制、权限等级为负。
  const cannotListen = raw.freeTrialPrivilege?.cannotListenReason
  if (raw.noCopyrightRcmd != null || cannotListen != null) return null
  const privilegeLevel = Number(raw.privilege?.st ?? raw.privilege?.status ?? 0)
  if (Number.isFinite(privilegeLevel) && privilegeLevel < 0) return null
  const title = firstString(raw.songName, raw.name, raw.title, raw.trackName)
  if (!title) return null
  const artists = joinArtists(raw.artists ?? raw.ar ?? raw.artistName ?? raw.singerName ?? raw.artist)
  const album = firstString(raw.albumName, raw.album?.name, raw.al?.name, typeof raw.album === 'string' ? raw.album : '')
  const duration = normalizeDuration(raw.duration ?? raw.durationMs ?? raw.dt ?? raw.interval)
  const out = { song_id: songId, title, artist: artists, album, duration }
  const source = firstString(raw.source, raw.__source)
  if (source) out.source = source.slice(0, 40)
  // 来源池（seed / playlist / search）：一阶段唯一可信的判断依据，见 ORIGIN_RANK
  const origin = firstString(raw.origin, raw.__origin)
  if (origin) out.origin = origin
  if (encrypted) out.encrypted_id = encrypted
  return out
}

export function normalizeTracks(list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const item of list) {
    const t = normalizeTrack(item)
    if (t) out.push(t)
  }
  return out
}

/**
 * 标题指纹：去掉括号里的后缀、标点与空白，用于识别「同一首曲子的不同版本」。
 * 实测 `Shootout` 与 `Shootout (Sped Up)` 会同时进池——song_id 不同，按 id 去重去不掉，
 * 但听感分析会把它们当成两首不同候选白算一遍。
 */
export function titleSignature(track) {
  const title = String(track?.title ?? '')
    .replace(/[（(\[【][^）)\]】]*[）)\]】]/g, ' ')
    .replace(/[\s\-_/·・.,!?'"“”‘’~]/g, '')
    .toLowerCase()
  const artist = String(track?.artist ?? '').replace(/\s/g, '').toLowerCase()
  return title === '' ? '' : `${title}|${artist}`
}

export function dedupe(tracks) {
  const seen = new Map()
  for (const t of tracks) {
    if (!seen.has(t.song_id)) seen.set(t.song_id, t)
  }
  return [...seen.values()]
}

export function passesLength(track, { min = 90, max = 900 } = {}) {
  if (!track.duration) return true
  return track.duration >= min && track.duration <= max
}

const TEXTURE_HINTS = {
  drone: ['ambient', 'drone', '氛围', '环境', 'synth'],
  strings: ['violin', 'cello', 'strings', '弦乐', '小提琴', '大提琴'],
  piano: ['piano', '钢琴'],
  percussion: ['percussion', 'drums', '鼓', '打击'],
  synth: ['synth', '电子', '合成器'],
  choir: ['choir', '合唱', '圣歌', 'chant', '吟唱'],
  folk: ['folk', '民乐', '古风', '民族']
}

const MOOD_HINTS = {
  'static:dark': ['恐怖', '压抑', '黑暗', '悲伤', '诡', '惊悚', 'horror', 'dark', 'sad', 'melancholy'],
  'static:neutral': ['安静', '静谧', '平和', '氛围', 'calm', 'quiet', 'ambient'],
  'static:bright': ['治愈', '温柔', '轻快', 'happy', 'gentle'],
  'building:dark': ['悬疑', '不安', '紧张', '阴谋', 'suspense', 'tension', 'mystery'],
  'building:neutral': ['紧张', '悬疑', '推进', 'tension'],
  'building:bright': ['希望', '渐强', 'rising', 'hope'],
  'driving:dark': ['追逐', '紧迫', '追赶', '逃亡', 'chase', 'pursuit'],
  'driving:neutral': ['战斗', '紧张', 'battle', 'combat'],
  'driving:bright': ['冒险', '热血', 'adventure', 'journey'],
  'burst:dark': ['史诗', '战斗', '黑暗', '决战', 'epic', 'battle'],
  'burst:neutral': ['战斗', '爆发', 'battle', 'epic', 'fight'],
  'burst:bright': ['热血', '战斗', '英雄', 'heroic', 'victory']
}

/** 命中该 cue 情绪关键词的第一个词，没有就返回空串（给推荐说明用）。 */
export function matchMoodKeyword(track, tags) {
  const hay = `${track?.title ?? ''} ${track?.artist ?? ''} ${track?.album ?? ''}`.toLowerCase()
  for (const hint of moodHints(tags)) {
    if (hay.includes(String(hint).toLowerCase())) return String(hint)
  }
  return ''
}

/** 把 cue 的标签翻成关键词，用来在候选里挑"更像这一段"的曲子。 */
function moodHints(tags) {
  const key = `${tags?.energy ?? 'static'}:${tags?.valence ?? 'neutral'}`
  return MOOD_HINTS[key] ?? []
}

/**
 * 给候选打分。不是最终排序，只是把明显不对的压到后面，
 * 让 agent 看到列表时先看到像的。
 */
export function scoreTrack(track, { tags = {}, directives = [], avoidKeywords = [] } = {}) {
  let score = 0
  const haystack = `${track.title} ${track.artist} ${track.album}`.toLowerCase()

  if (CLEAN_HINT.test(haystack)) score += 4
  if (/bgm|背景音乐|配乐|原声/i.test(haystack)) score += 3
  if (/(ost|soundtrack)/i.test(haystack)) score += 3
  if (/抖音|神曲|热歌|广场舞|土嗨/i.test(haystack)) score -= 8

  // 这一段自己写的忌讳（如「人声」「翻唱」）：标题/专辑里命中就压下去
  for (const keyword of avoidKeywords) {
    const needle = String(keyword ?? '').trim().toLowerCase()
    if (needle !== '' && haystack.includes(needle)) score -= 4
  }

  for (const hint of moodHints(tags)) {
    if (haystack.includes(String(hint).toLowerCase())) { score += 4; break }
  }
  for (const directive of directives) {
    const effect = directive?.effect
    if (!effect) continue
    if (Array.isArray(effect.exclude_texture)) {
      for (const texture of effect.exclude_texture) {
        const hints = TEXTURE_HINTS[texture] ?? [texture]
        if (hints.some((h) => haystack.includes(String(h).toLowerCase()))) score -= 6
      }
    }
    if (Array.isArray(effect.include_texture)) {
      for (const texture of effect.include_texture) {
        const hints = TEXTURE_HINTS[texture] ?? [texture]
        if (hints.some((h) => haystack.includes(String(h).toLowerCase()))) score += 2
      }
    }
    if (Array.isArray(effect.exclude_keywords)) {
      for (const kw of effect.exclude_keywords) {
        if (kw && haystack.includes(String(kw).toLowerCase())) score -= 8
      }
    }
  }
  if (tags.vocal === 'none' && /(vocal|派)|feat\.?|ft\./i.test(haystack)) score -= 1
  if (track.duration >= 150) score += 1
  return score
}

/**
 * 一阶段（还没听音频）唯一可信的信息是「这首歌从哪个池子来」。
 * 主题歌单是人工策展过的，命中率最高；歌曲搜索次之；
 * 种子歌单是用户自己的收藏，主题可能和本段完全无关，只在缺口时补位。
 * 排在前面的池子优先占名额，池子内再按关键词分与歌单内顺序排。
 */
export const ORIGIN_RANK = { playlist: 2, search: 1, unknown: 1, seed: 0 }

export function originOf(track) {
  const declared = String(track?.origin ?? '')
  if (declared in ORIGIN_RANK) return declared
  const source = String(track?.source ?? '')
  if (source === '我的种子歌单') return 'seed'
  if (source.startsWith('歌曲搜索')) return 'search'
  return source ? 'playlist' : 'unknown'
}

/** 候选排序的元组比较：来源池 → 关键词分 → 出自该池的先后 → song_id。全是确定值，没有随机。 */
function compareCandidates(a, b) {
  return (b.originRank - a.originRank)
    || (b.fetchScore - a.fetchScore)
    || (a.sourceOrder - b.sourceOrder)
    || (a.song_id - b.song_id)
}

/** 过滤 + 去重 + 打分排序 + 多样性限流，返回可直接写进 candidates 的数组。 */
export function prepareCandidates(tracks, {
  tags = {}, directives = [], limit = 12, minSec = 90, maxSec = 900,
  avoid = new Set(), avoidKeywords = []
} = {}) {
  const cleaned = dedupe(normalizeTracks(tracks))
    .filter((t) => !isNoise(t.title))
    .filter((t) => passesLength(t, { min: minSec, max: maxSec }))
    .map((t, index) => {
      const origin = originOf(t)
      return {
        ...t,
        origin,
        // 抓取期只能给「关键词分」，不是听感分。听感分在 bgm_tag 之后写回 score。
        fetchScore: scoreTrack(t, { tags, directives, avoidKeywords }) - (avoid.has(t.song_id) ? 6 : 0),
        originRank: ORIGIN_RANK[origin] ?? 1,
        // 池子里的原始顺序：主题歌单的排序本身就是策展人的判断，越靠前越该先看
        sourceOrder: index,
        intro_unknown: true
      }
    })
    .sort(compareCandidates)

  // 同一张专辑/同一位艺人最多留 2 首，否则一张专辑会把候选表刷屏
  const picked = []
  const albumCount = new Map()
  const artistCount = new Map()
  const leftover = []
  for (const track of cleaned) {
    const album = track.album || ''
    const artist = track.artist || ''
    if ((albumCount.get(album) ?? 0) >= 2 || (artistCount.get(artist) ?? 0) >= 2) {
      leftover.push(track)
      continue
    }
    if (picked.length >= limit) { leftover.push(track); continue }
    picked.push(track)
    albumCount.set(album, (albumCount.get(album) ?? 0) + 1)
    artistCount.set(artist, (artistCount.get(artist) ?? 0) + 1)
  }
  // 不够就用剩下的补齐
  for (const track of leftover) {
    if (picked.length >= limit) break
    picked.push(track)
  }
  return picked.slice(0, limit)
}



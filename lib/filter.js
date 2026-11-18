// 候选曲目的归一化、去噪、去重与打分。纯函数，无 I/O。

const NOISE = [
  /(?:^|[\s(（[-])(live|现场版|演唱会)(?:$|[\s)）\]])/i,
  /翻唱|cover(?!\s*art)/i,
  /remix|混音版|dj版/i,
  /伴奏(?:版)?/i,
  /片段|试听|铃声|抖音|剪辑/i,
  /钢琴版|吉他版|八音盒|音乐盒/i
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
  if (raw.playFlag === false) return null // 平台明确标记不可播
  const title = firstString(raw.songName, raw.name, raw.title, raw.trackName)
  if (!title) return null
  const artists = joinArtists(raw.artists ?? raw.ar ?? raw.artistName ?? raw.singerName ?? raw.artist)
  const album = firstString(raw.albumName, raw.album?.name, raw.al?.name, typeof raw.album === 'string' ? raw.album : '')
  const duration = normalizeDuration(raw.duration ?? raw.durationMs ?? raw.dt ?? raw.interval)
  const out = { song_id: songId, title, artist: artists, album, duration }
  const source = firstString(raw.source, raw.__source)
  if (source) out.source = source.slice(0, 40)
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

function hashStr(value) {
  let h = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** 过滤 + 去重 + 打分排序 + 多样性限流，返回可直接写进 candidates 的数组。 */
export function prepareCandidates(tracks, {
  tags = {}, directives = [], limit = 8, minSec = 90, maxSec = 900,
  avoid = new Set(), avoidKeywords = [], salt = ''
} = {}) {
  const cleaned = dedupe(normalizeTracks(tracks))
    .filter((t) => !isNoise(t.title))
    .filter((t) => passesLength(t, { min: minSec, max: maxSec }))
    .map((t) => ({
      ...t,
      score: scoreTrack(t, { tags, directives, avoidKeywords }) - (avoid.has(t.song_id) ? 6 : 0),
      intro_unknown: true
    }))
    // 打平时用 (salt, song_id) 的哈希排序：同一段稳定，不同段不同，
    // 否则一堆 0 分的曲子会按标题字母序被所有段落重复选中
    .sort((a, b) => b.score - a.score
      || (hashStr(`${salt}:${a.song_id}`) % 997) - (hashStr(`${salt}:${b.song_id}`) % 997))

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



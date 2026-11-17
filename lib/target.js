// 场景 → 目标标签 + 权重。
//
// v4.3：目标直接用 music2emo 的原生标签（dark / dramatic / calm …）。
// 中文场景描述只用来「选词」，不参与打分；「紧张」「温馨」不是标签，
// 而是落成 dramatic+heavy 或 soft+hopeful 这样的组合。
// 注意：模型的 56 个标签里没有 horror / mellow / ambiental，恐怖靠 dark 组合表达。

/** 中文线索 → 原生标签（权重为相对值，最后统一归一化）。 */
const KEYWORD_TAGS = [
  { re: /恐怖|骇|惊悚|尸|怪物|邪神|血肉|蠕/, tags: [['dark', 1], ['dramatic', 0.6], ['heavy', 0.4]] },
  { re: /诡异|怪诞|扭曲|不对劲|异常|腐/, tags: [['dark', 0.8], ['dream', 0.4], ['dramatic', 0.3]] },
  { re: /紧张|对峙|倒计时|逼仄|山雨欲来|一触即发|危险/, tags: [['dramatic', 1], ['heavy', 0.6], ['dark', 0.4]] },
  { re: /悬疑|谜|调查|线索|疑云|真相/, tags: [['dramatic', 0.8], ['deep', 0.5], ['dark', 0.4]] },
  { re: /压迫|沉重|窒息|低沉|威压/, tags: [['heavy', 1], ['dark', 0.7], ['powerful', 0.4]] },
  { re: /追逐|逃跑|逃亡|追捕|奔逃/, tags: [['action', 1], ['fast', 0.8], ['energetic', 0.6]] },
  { re: /战斗|厮杀|血战|冲突|开打/, tags: [['action', 0.8], ['energetic', 0.8], ['heavy', 0.6]] },
  { re: /史诗|宏大|壮阔|辽阔|雄伟|决战/, tags: [['epic', 1], ['powerful', 0.7], ['inspiring', 0.3]] },
  { re: /悲伤|忧伤|哀|恸|离别|失去|悼/, tags: [['sad', 1], ['melancholic', 0.8]] },
  { re: /孤独|孤寂|空旷|荒凉|无人|废墟|余烬/, tags: [['sad', 0.5], ['deep', 0.6], ['calm', 0.5], ['space', 0.4]] },
  { re: /阴郁|压抑|黑暗|绝望|沉沦/, tags: [['dark', 1], ['melancholic', 0.6], ['heavy', 0.4]] },
  { re: /安静|静谧|宁静|寂静|静默|安稳/, tags: [['calm', 1], ['soft', 0.6], ['relaxing', 0.5]] },
  { re: /温馨|温暖|篝火|营地|家|同伴|火光/, tags: [['soft', 0.9], ['hopeful', 0.7], ['love', 0.4]] },
  { re: /治愈|安抚|慰藉|安心|休整/, tags: [['hopeful', 0.8], ['relaxing', 0.7], ['soft', 0.6]] },
  { re: /欢快|欢庆|热闹|节日|庆典|集市|派对/, tags: [['happy', 1], ['upbeat', 0.8], ['fun', 0.5]] },
  { re: /轻快|俏皮|活泼|灵动|轻巧/, tags: [['happy', 0.8], ['upbeat', 0.6], ['fun', 0.5]] },
  { re: /律动|节奏|鼓点|心跳|脉动/, tags: [['groovy', 1], ['energetic', 0.6]] },
  { re: /激烈|狂热|暴烈|冲击|爆发/, tags: [['energetic', 0.9], ['heavy', 0.7], ['action', 0.5]] },
  { re: /太空|宇宙|星|虚空|深渊|天穹/, tags: [['space', 1], ['dream', 0.7], ['meditative', 0.5]] },
  { re: /神秘|未知|谜团|幽微|低语/, tags: [['dream', 0.7], ['space', 0.5], ['dark', 0.4]] },
  { re: /空灵|缥缈|飘忽|幻觉|梦境/, tags: [['dream', 1], ['space', 0.6], ['meditative', 0.5]] },
  { re: /探索|冒险|远行|旅途|启程/, tags: [['adventure', 1], ['uplifting', 0.6], ['inspiring', 0.4]] },
  { re: /圣|教堂|仪式|仪式感|庄严/, tags: [['epic', 0.6], ['emotional', 0.6], ['meditative', 0.5]] },
  { re: /爵士|酒馆|酒吧|歌舞|欢宴/, tags: [['groovy', 0.8], ['cool', 0.6], ['fun', 0.4]] }
]

/** 旧 schema 的 tags（valence/energy/tension）→ 原生标签；用于迁移与自动预填。 */
const TAG_RULES = [
  { when: (t) => t.valence === 'dark', add: [['dark', 1], ['dramatic', 0.4]] },
  { when: (t) => t.valence === 'bright', add: [['happy', 1], ['upbeat', 0.5]] },
  { when: (t) => t.energy === 'static', add: [['calm', 1], ['soft', 0.4]] },
  { when: (t) => t.energy === 'building', add: [['dramatic', 1], ['emotional', 0.5]] },
  { when: (t) => t.energy === 'driving', add: [['groovy', 1], ['energetic', 0.5]] },
  { when: (t) => t.energy === 'burst', add: [['epic', 1], ['powerful', 0.7]] },
  { when: (t) => Number(t.tension) >= 7, add: [['heavy', 0.8], ['dramatic', 0.5]] },
  { when: (t) => t.vocal === 'none', add: [] }
]

function accumulate(into, pairs) {
  for (const [tag, weight] of pairs) {
    const name = String(tag).toLowerCase()
    const prev = into.get(name) ?? 0
    into.set(name, Math.max(prev, weight))
  }
}

/**
 * 从一段戏推导目标标签（迁移与预填用）。
 * @param {object} cue
 * @param {string[]|Set<string>} allowed 词表内允许的标签
 * @returns {{tag: string, weight: number}[]}
 */
export function deriveTarget(cue, allowed) {
  const allow = allowed instanceof Set ? allowed : new Set(allowed ?? [])
  const weights = new Map()
  const tags = cue?.tags ?? {}
  for (const rule of TAG_RULES) {
    if (rule.when(tags)) accumulate(weights, rule.add)
  }
  const haystack = [
    ...(Array.isArray(cue?.wants) ? cue.wants : []),
    cue?.scene ?? '',
    cue?.trigger ?? '',
    cue?.note ?? ''
  ].join(' ')
  for (const item of KEYWORD_TAGS) {
    if (item.re.test(haystack)) accumulate(weights, item.tags)
  }
  const filtered = [...weights.entries()].filter(([tag]) => allow.size === 0 || allow.has(tag))
  if (filtered.length === 0) {
    return normalizeTarget([{ tag: allow.has('calm') || allow.size === 0 ? 'calm' : [...allow][0], weight: 1 }], allow)
  }
  return normalizeTarget(filtered.map(([tag, weight]) => ({ tag, weight })), allow)
}

/**
 * 校验并归一化目标：只保留词表内的标签、去重、最多 6 个、权重和为 1。
 * @param {{tag: string, weight?: number}[]} input
 * @param {string[]|Set<string>} allowed
 */
export function normalizeTarget(input, allowed) {
  const allow = allowed instanceof Set ? allowed : new Set(allowed ?? [])
  const merged = new Map()
  for (const item of Array.isArray(input) ? input : []) {
    const tag = String(item?.tag ?? '').replace(/^mood\/theme---/, '').trim().toLowerCase()
    if (tag === '') continue
    if (allow.size > 0 && !allow.has(tag)) continue
    const weight = Number(item?.weight)
    const value = Number.isFinite(weight) && weight > 0 ? weight : 1
    merged.set(tag, (merged.get(tag) ?? 0) + value)
  }
  let entries = [...merged.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  if (entries.length === 0) return []
  const sum = entries.reduce((acc, [, w]) => acc + w, 0)
  entries = entries.map(([tag, w]) => ({ tag, weight: Math.round((w / sum) * 100) / 100 }))
  // 舍入后的余量补到第一个，保证和严格为 1
  const drift = Math.round((1 - entries.reduce((acc, e) => acc + e.weight, 0)) * 100) / 100
  if (drift !== 0) entries[0].weight = Math.round((entries[0].weight + drift) * 100) / 100
  return entries
}

/** 目标的标签名数组。 */
export function targetTags(target) {
  return Array.isArray(target) ? target.map((item) => item.tag) : []
}

/** 目标里权重最大的标签，用于检索与说明。 */
export function primaryTag(target) {
  if (!Array.isArray(target) || target.length === 0) return ''
  return [...target].sort((a, b) => b.weight - a.weight)[0].tag
}

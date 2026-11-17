// 把一段戏的需求翻译成「词表里的哪些概念」。
//
// v2：不再返回英文句子，而是返回**概念标签**——实际句子在 lib/vocabulary.js，
// 每个概念有 3–5 个说法取平均，用户还能覆盖。这样一处改词表，全表生效。
//
// 判断依据仍是：标签（明暗/能量/织体）+ wants 里的中文关键词，最多 6 个概念。

const TEXTURE_LABELS = {
  drone: '暗色氛围',
  piano: '安静钢琴',
  strings: '弦乐',
  percussion: '打击乐',
  synth: '合成器',
  choir: '合唱',
  folk: '民谣木吉他'
}

// 中文关键词 → 概念标签。顺序即优先级，命中先入。
const KEYWORD_LABELS = [
  { match: /太空|宇宙|星系|天穹/, label: '太空氛围' },
  { match: /机械|设备|仪器|齿轮|活塞/, label: '机械电子' },
  { match: /圣咏|弥撒|吟唱/, label: '圣咏' },
  { match: /合唱|无词人声/, label: '合唱' },
  { match: /爵士|酒吧|点唱机/, label: '爵士' },
  { match: /军鼓|行进|队列/, label: '军鼓行进' },
  { match: /不协和|嗡鸣|低频|底噪/, label: '不协和低鸣' },
  { match: /虫群|爬行|密集|群鸦|昆虫/, label: '密集虫群' },
  { match: /地震|地动|震动|崩塌/, label: '地震轰鸣' },
  { match: /暴风雨|雷暴|闪电|暴雨/, label: '暴风雨' },
  { match: /燃烧|火焰|纵火|暴乱|火灾/, label: '暴乱燃烧' },
  { match: /追逐|追捕|逃跑|逃亡/, label: '追逐' },
  { match: /恐怖|骇人|惊悚|诡异/, label: '恐怖配乐' },
  { match: /安静|空旷|静谧|余烬|寂静/, label: '安静空旷' },
  { match: /史诗|宏大|辽阔|壮阔/, label: '史诗管弦' },
  { match: /电子|脉冲|信号|电路/, label: '电子脉冲' },
  { match: /轻快|欢快|活泼|俏皮/, label: '活泼器乐' },
  { match: /沉重|压抑|黑暗|阴森/, label: '暗色氛围' }
]

/** 这一段期望命中哪些概念（最多 6 个）。 */
export function cueLabels(cue) {
  const tags = cue?.tags ?? {}
  const textures = Array.isArray(tags.texture) ? tags.texture : []
  const out = []
  const push = (label) => {
    if (label && !out.includes(label)) out.push(label)
  }

  if (tags.valence === 'dark') {
    push('暗色氛围')
    push('紧张悬疑')
  } else if (tags.valence === 'bright') {
    push('活泼器乐')
    push('欢快流行')
  }
  if (tags.energy === 'burst') push('激烈攻击')
  if (tags.energy === 'driving') push('律动')

  // 「忧伤」只对器乐/中性情绪成立。黑暗 + 纯氛围的段落里加上它，
  // 会让任何一首悲伤钢琴曲拿到高分——实测把"大地的心跳"判成了《Kindness》。
  const melancholyFits = tags.valence === 'neutral'
    || textures.includes('piano')
    || textures.includes('strings')
    || textures.includes('folk')
  if (tags.energy === 'static' && melancholyFits) push('忧伤')

  for (const texture of textures) push(TEXTURE_LABELS[texture])

  const haystack = [
    ...(Array.isArray(cue?.wants) ? cue.wants : []),
    cue?.scene ?? '',
    cue?.trigger ?? ''
  ].join(' ')
  for (const item of KEYWORD_LABELS) {
    if (item.match.test(haystack)) push(item.label)
  }

  if (out.length === 0) push('器乐')
  return out.slice(0, 6)
}

/** 匹配度分档，供 UI 上色与文案。 */
export function matchLevel(match) {
  if (!Number.isFinite(match)) return 'unknown'
  if (match >= 0.5) return 'good'
  if (match >= 0.25) return 'fair'
  return 'poor'
}

/** 兼容旧调用：返回 [{label}] 形状。 */
export function cuePrompts(cue) {
  return cueLabels(cue).map((label) => ({ label, text: label }))
}


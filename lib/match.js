// 把一段戏的需求翻成 CLAP 能打分的英文 prompt。
//
// 为什么不能只用全局那 12 个标签：cue 里写的「太空/机械/圣咏/军鼓」根本不在词表里，
// 拿"史诗管弦"去凑，所有歌的匹配度都会低——那不是歌不对，是我们没问对问题。
//
// 做法：标签（valence/energy/texture）给基础集，wants 里的中文关键词用一张小词表
// 映射成额外 prompt，两者合并后最多 6 条。

const TEXTURE_PROMPTS = {
  drone: { text: 'dark ambient drone', label: '暗色氛围' },
  piano: { text: 'calm gentle piano music', label: '安静钢琴' },
  strings: { text: 'melancholic string ensemble', label: '弦乐' },
  percussion: { text: 'aggressive intense percussion', label: '打击乐' },
  synth: { text: 'synthesizer electronic atmosphere', label: '合成器' },
  choir: { text: 'epic orchestral choir', label: '合唱' },
  folk: { text: 'acoustic folk guitar', label: '民谣木吉他' }
}

// 中文关键词 → prompt。命中即追加，没命中也没关系（标签集兜底）。
const KEYWORD_PROMPTS = [
  { match: /太空|宇宙|星系|天穹/g, text: 'cosmic space ambient music', label: '太空氛围' },
  { match: /机械|设备|仪器|齿轮/g, text: 'mechanical industrial electronic music', label: '机械电子' },
  { match: /圣咏|弥撒|合唱|吟唱/g, text: 'gregorian chant choir', label: '圣咏' },
  { match: /爵士|酒吧|点唱机/g, text: 'smoky jazz trio', label: '爵士' },
  { match: /军鼓|行进|队列/g, text: 'marching snare drums', label: '军鼓行进' },
  { match: /不协和|嗡鸣|低频|轰鸣/g, text: 'dissonant low frequency drone', label: '不协和低鸣' },
  { match: /虫群|爬行|密集|群鸦/g, text: 'swarming unsettling texture', label: '密集虫群' },
  { match: /地震|地动|震动/g, text: 'rumbling seismic impact', label: '地震轰鸣' },
  { match: /暴风雨|雷暴|闪电|雨/g, text: 'storm wind and rain ambience', label: '暴风雨' },
  { match: /燃烧|火焰|纵火|暴乱/g, text: 'chaotic burning riot', label: '暴乱燃烧' },
  { match: /追逐|追捕|逃/g, text: 'tense chase music', label: '追逐' },
  { match: /恐怖|骇人|惊悚/g, text: 'horror soundtrack', label: '恐怖配乐' },
  { match: /安静|空旷|静谧|余烬/g, text: 'sparse quiet ambient', label: '安静空旷' },
  { match: /史诗|宏大|辽阔/g, text: 'epic orchestral music', label: '史诗管弦' },
  { match: /电子|脉冲|信号/g, text: 'electronic pulse and signal tones', label: '电子脉冲' }
]

/** 按 cue 的标签与需求，给出这一段的期望词表（最多 6 条）。 */
export function cuePrompts(cue) {
  const tags = cue?.tags ?? {}
  const out = []
  const seen = new Set()
  const push = (item) => {
    if (item === null || item === undefined) return
    if (seen.has(item.text)) return
    seen.add(item.text)
    out.push(item)
  }

  if (tags.valence === 'dark') {
    push({ text: 'dark ambient drone', label: '暗色氛围' })
    push({ text: 'tense suspenseful music', label: '紧张悬疑' })
  } else if (tags.valence === 'bright') {
    push({ text: 'feel-good upbeat music', label: '轻快' })
    push({ text: 'epic orchestral music', label: '史诗管弦' })
  }
  if (tags.energy === 'burst') push({ text: 'aggressive intense music', label: '激烈攻击' })
  if (tags.energy === 'driving') push({ text: 'groovy rhythmic dance music', label: '律动' })
  // 「忧伤」只对器乐/中性情绪成立。黑暗 + 纯氛围的段落里加上它，
  // 会让任何一首悲伤钢琴曲拿到高分——实测把"大地的心跳"判成了《Kindness》。
  const textures = Array.isArray(tags.texture) ? tags.texture : []
  const melancholyFits = tags.valence === 'neutral'
    || textures.includes('piano')
    || textures.includes('strings')
    || textures.includes('folk')
  if (tags.energy === 'static' && melancholyFits) push({ text: 'sad melancholic music', label: '忧伤' })
  for (const texture of Array.isArray(tags.texture) ? tags.texture : []) {
    push(TEXTURE_PROMPTS[texture])
  }

  const haystack = [
    ...(Array.isArray(cue?.wants) ? cue.wants : []),
    ...(Array.isArray(cue?.avoids) ? [] : []),
    cue?.scene ?? ''
  ].join(' ')
  for (const item of KEYWORD_PROMPTS) {
    if (item.match.test(haystack)) push({ text: item.text, label: item.label })
  }

  if (out.length === 0) push({ text: 'instrumental background music', label: '器乐' })
  return out.slice(0, 6)
}

/** 匹配度分档，供 UI 上色与文案。 */
export function matchLevel(match) {
  if (!Number.isFinite(match)) return 'unknown'
  if (match >= 0.35) return 'good'
  if (match >= 0.2) return 'fair'
  return 'poor'
}


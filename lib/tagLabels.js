// 标签的中文显示名。
//
// 数据里存的一直是模型的原生英文标签（dark / dramatic / …），中文只用于界面展示。
// 改这里不会影响打分，也不会影响词表校验。

export const TAG_LABELS = {
  action: '动作',
  adventure: '冒险',
  advertising: '广告',
  background: '背景',
  ballad: '叙事曲',
  calm: '平静',
  children: '童趣',
  christmas: '圣诞',
  commercial: '商业',
  cool: '酷感',
  corporate: '企业',
  dark: '黑暗',
  deep: '深沉',
  documentary: '纪实',
  drama: '戏剧',
  dramatic: '戏剧张力',
  dream: '梦幻',
  emotional: '情感',
  energetic: '活力',
  epic: '史诗',
  fast: '快节奏',
  film: '电影配乐',
  fun: '有趣',
  funny: '滑稽',
  game: '游戏',
  groovy: '律动',
  happy: '欢快',
  heavy: '沉重',
  holiday: '假日',
  hopeful: '希望',
  inspiring: '励志',
  love: '爱意',
  meditative: '冥想',
  melancholic: '忧郁',
  melodic: '旋律',
  motivational: '激励',
  movie: '电影',
  nature: '自然',
  party: '派对',
  positive: '积极',
  powerful: '力量',
  relaxing: '放松',
  retro: '复古',
  romantic: '浪漫',
  sad: '悲伤',
  sexy: '性感',
  slow: '缓慢',
  soft: '柔和',
  soundscape: '声景',
  space: '太空',
  sport: '运动',
  summer: '夏日',
  trailer: '预告片',
  travel: '旅途',
  upbeat: '轻快',
  uplifting: '昂扬'
}

/** 英文标签 → 中文显示名；未知标签原样返回。 */
export function labelOf(tag) {
  return TAG_LABELS[String(tag).toLowerCase()] ?? String(tag)
}

/** 中文显示名 → 英文标签；找不到返回空字符串。 */
export function tagOf(label) {
  const wanted = String(label).trim()
  for (const [tag, text] of Object.entries(TAG_LABELS)) {
    if (text === wanted) return tag
  }
  return ''
}

/**
 * 词表外的标签怎么提示。
 * 如果写的是中文显示名（例如「黑暗」），直接告诉它对应的英文标签；
 * 其它无效标签原样返回。
 */
export function droppedHint(tag) {
  const english = tagOf(tag)
  return english ? `${tag} → ${english}` : String(tag)
}

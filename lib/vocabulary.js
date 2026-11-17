// 打标词表：每个「概念」配 3–5 个英文说法，向量取平均再与音频比。
//
// 为什么不能一个概念一句话：CLAP 是检索模型，一个句子的语感决定了它的邻域。
// 实测《ひやむぎ、そーめん、时々うどん》在 `feel-good upbeat music` 下「轻快」只有 0.02，
// 扩成 4 句平均后变成 0.83——同样的模型、同样的音频。
//
// 用户可覆盖：$DSH_HOME/bgm-prep/vocabulary.json
// 格式 [{ "label": "轻快", "prompts": ["...", "..."] }]；同 label 会**替换**默认的 prompts。

export const DEFAULT_VOCABULARY = [
  {
    label: '活泼器乐',
    prompts: [
      'cheerful playful acoustic guitar',
      'bouncy light-hearted folk tune',
      'happy accordion and strings',
      'bright lively instrumental',
      'whimsical upbeat violin and piano'
    ]
  },
  {
    label: '欢快流行',
    prompts: ['feel-good upbeat pop song', 'happy catchy radio pop', 'sunny cheerful dance pop']
  },
  {
    label: '安静钢琴',
    prompts: ['calm gentle piano music', 'solo piano ballad', 'soft contemplative piano', 'delicate quiet piano']
  },
  {
    label: '忧伤',
    prompts: ['sad melancholic music', 'mournful slow strings', 'wistful lonely piano', 'sorrowful elegy']
  },
  {
    label: '紧张悬疑',
    prompts: ['tense suspenseful music', 'eerie creeping atmosphere', 'nervous pulsing underscore', 'dread build-up']
  },
  {
    label: '恐怖配乐',
    prompts: ['horror soundtrack', 'scary dissonant film score', 'unsettling creepy ambience', 'nightmare drone with stingers']
  },
  {
    label: '暗色氛围',
    prompts: ['dark ambient drone', 'brooding atmospheric texture', 'bleak soundscape', 'shadowy hum']
  },
  {
    label: '史诗管弦',
    prompts: ['epic orchestral music', 'heroic cinematic strings', 'grand swelling orchestra', 'trailer music with brass']
  },
  {
    label: '激烈攻击',
    prompts: ['aggressive intense music', 'brutal heavy hitting track', 'furious distorted climax']
  },
  {
    label: '律动',
    prompts: ['groovy rhythmic track', 'beat-driven instrumental', 'pulsing percussive groove', 'hypnotic rhythmic loop']
  },
  {
    label: '打击乐',
    prompts: ['percussion driven track', 'tribal drums and hits', 'marching rhythm section']
  },
  {
    label: '合成器',
    prompts: ['synthesizer electronic atmosphere', 'analog synth pads', 'modular synth texture']
  },
  {
    label: '电子脉冲',
    prompts: ['electronic pulse and signal tones', 'glitchy electronic beeps', 'machine signal rhythm']
  },
  {
    label: '弦乐',
    prompts: ['melancholic string ensemble', 'slow cello and violins', 'chamber strings']
  },
  {
    label: '合唱',
    prompts: ['epic orchestral choir', 'wordless vocal choir pad', 'monastic voices']
  },
  {
    label: '圣咏',
    prompts: ['gregorian chant choir', 'sacred latin chanting', 'church organ and choir']
  },
  {
    label: '民谣木吉他',
    prompts: ['acoustic folk guitar', 'fingerpicked acoustic guitar', 'campfire folk strumming']
  },
  {
    label: '爵士',
    prompts: ['smoky jazz trio', 'swinging jazz piano bass drums', 'lounge jazz standard']
  },
  {
    label: '军鼓行进',
    prompts: ['marching snare drums', 'military drum cadence', 'marching band rhythm']
  },
  {
    label: '不协和低鸣',
    prompts: ['dissonant low frequency drone', 'sub-bass rumble and dissonance', 'grinding low tones']
  },
  {
    label: '密集虫群',
    prompts: ['swarming unsettling texture', 'insect-like clicking noise', 'dense crawling sound bed']
  },
  {
    label: '地震轰鸣',
    prompts: ['rumbling seismic impact', 'deep earth tremble and crash', 'cataclysmic rumble']
  },
  {
    label: '暴风雨',
    prompts: ['storm wind and rain ambience', 'thunder and howling gale', 'tempest soundscape']
  },
  {
    label: '暴乱燃烧',
    prompts: ['chaotic burning riot', 'panicked crowd and fire', 'destruction and crackling flames']
  },
  {
    label: '追逐',
    prompts: ['tense chase music', 'racing action pulse', 'fleeing urgency rhythms']
  },
  {
    label: '安静空旷',
    prompts: ['sparse quiet ambient', 'empty room tone with reverb', 'desolate silence with air']
  },
  {
    label: '太空氛围',
    prompts: ['cosmic space ambient music', 'vast void soundscape', 'floating through stars']
  },
  {
    label: '机械电子',
    prompts: ['mechanical industrial electronic music', 'machine clanks and pistons', 'factory rhythm texture']
  },
  {
    label: '器乐',
    prompts: ['instrumental music without vocals', 'pure instrumental track', 'music with no singing']
  }
]

/** 读用户自定义词表并与默认合并（同 label 用用户的 prompts 覆盖）。 */
export function mergeVocabulary(custom) {
  const byLabel = new Map(DEFAULT_VOCABULARY.map((item) => [item.label, item]))
  for (const item of Array.isArray(custom) ? custom : []) {
    const label = String(item?.label ?? '').trim()
    const prompts = (Array.isArray(item?.prompts) ? item.prompts : [])
      .map((text) => String(text ?? '').trim())
      .filter((text) => text !== '')
    if (label === '' || prompts.length === 0) continue
    byLabel.set(label, { label, prompts })
  }
  return [...byLabel.values()]
}

/** 实际生效的词表：默认 + $DSH_HOME/bgm-prep/vocabulary.json 的覆盖。 */
export async function loadVocabulary() {
  try {
    const fsp = await import('node:fs/promises')
    const path = await import('node:path')
    const ncm = await import('./ncm.js')
    const file = path.join(ncm.dataDir(), 'vocabulary.json')
    const raw = JSON.parse(await fsp.readFile(file, 'utf8'))
    return mergeVocabulary(raw)
  } catch {
    return mergeVocabulary([])
  }
}

// dsh-bgm-prep —— 跑团备团配乐（Host 插件，零模型调用）
//
// 插件只做确定性的事：校验、检索、落盘、出表、导出。
// 认场景、打标签、在候选里排序，全部由当前会话的 agent 完成（见 docs/WORKFLOW.md）。

import fsp from 'node:fs/promises'
import path from 'node:path'
import * as ncm from './ncm.js'
import {
  SheetError, cueStatus, emptySheet, normalizeSheet, readSheet, sheetPaths, summarize,
  validateCueInputs, writeSheet
} from './store.js'
import { prepareCandidates } from './filter.js'
import { collectForCue, loadSeedTracks } from './search.js'
import { renderPlaylistCsv, renderPlaylistText, renderReview, renderTable } from './format.js'
import { ROUTE_PREFIX, Workbench, isTrusted, recordHistory, rememberSheetFile, writeJson } from './ui.js'
import { applyAnalysis, analyzeTracks, engineHealth } from './analyze.js'
import { loadTags } from './tags.js'
import { droppedHint } from './tagLabels.js'

export const name = 'bgm-prep'
export const inject = ['tools', 'webServer']

const DEFAULTS = {
  candidateLimit: 8,
  fetchBudget: 200,
  seedPlaylists: []
}

async function readSettings() {
  try {
    const raw = JSON.parse(await fsp.readFile(path.join(ncm.dataDir(), 'settings.json'), 'utf8'))
    return { ...DEFAULTS, ...raw }
  } catch {
    return { ...DEFAULTS }
  }
}

function resolveFile(file, exec) {
  if (typeof file !== 'string' || file.trim() === '') {
    throw new SheetError('缺少 file 参数（cues.json 的路径）')
  }
  const base = exec?.agent?.session?.header?.cwd
  const resolved = path.isAbsolute(file) ? file : path.resolve(base || process.cwd(), file)
  return resolved
}

function text(value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
}

function fail(error) {
  return { ok: false, error: error?.message ?? String(error), hint: error?.hint ?? '' }
}

// ------------------------------------------------------------------ 工具定义

const INIT_PARAMS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    file: { type: 'string', description: '曲目表路径，通常是 <模组目录>/bgm/<scope>.cues.json。父目录会被创建。' },
    module: { type: 'string', description: '模组名，用于表头与歌单命名。' },
    session: { type: 'number', description: '第几回。' },
    scope: { type: 'string', description: '这一份管哪一段，例如 s3-act3、第三幕。会进文件名。' },
    cues: {
      type: 'array',
      description: '场景数组，按演出顺序。每项 {id?, scene, trigger?, target?, vocal?, wants?, avoids?, need_bgm?}。',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          scene: { type: 'string', description: '场景名，要具体，会印在表上。' },
          trigger: { type: 'string', description: '触发/上下文，一句话。' },
          target: {
            type: 'array',
            description: '目标听感：music2emo 的原生标签 + 权重，最多 6 个。不填时从 tags/wants 自动推导。',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                tag: { type: 'string', description: '如 dark / dramatic / calm，必须是词表里的标签。' },
                weight: { type: 'number', description: '相对权重，会自动归一化到和为 1。' }
              },
              required: ['tag']
            }
          },
          vocal: { type: 'string', enum: ['none', 'wordless', 'any'], description: '这段的人声偏好，默认 any。' },
          wants: { type: 'array', items: { type: 'string' }, description: '用户原话里的期望（检索用，不参与打分）。' },
          avoids: { type: 'array', items: { type: 'string' }, description: '用户原话里的禁忌。' },
          tags: {
            type: 'object',
            additionalProperties: false,
            description: '按演出功能打的标签，检索与排序都靠它。',
            properties: {
              tension: { type: 'number', description: '0-10，能不能盖过说话声。' },
              valence: { type: 'string', enum: ['bright', 'neutral', 'dark'] },
              energy: { type: 'string', enum: ['static', 'building', 'driving', 'burst'] },
              texture: { type: 'array', items: { type: 'string' }, description: 'drone/strings/piano/percussion/synth/choir/folk 之一。' },
              vocal: { type: 'string', enum: ['none', 'wordless', 'lyrics'] },
              min_len: { type: 'number', description: '一段对话不循环的最短时长（秒）。' }
            }
          },
          need_bgm: { type: 'boolean', description: '这一段要不要配乐。纯调查/规则结算/闲聊通常 false。' }
        },
        required: ['scene']
      }
    },
    directives: {
      type: 'array',
      description: '全局要求，从用户整场的话里抽出来。每项 {text, effect?}。',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
          effect: { type: 'object', additionalProperties: true }
        },
        required: ['text']
      }
    },
    mode: {
      type: 'string',
      enum: ['create', 'append', 'patch', 'replace'],
      description: 'create=新建（已存在则报错）；append=按 id 并入；patch=按 id 局部改；replace=整体覆盖（会先备份）。默认 create。'
    },
    source_path: { type: 'string', description: '回捞到的原文文件路径，登记到 source 字段（可选）。' }
  },
  required: ['file', 'module', 'scope', 'cues']
}

function createInitTool() {
  return {
    name: 'bgm_init',
    description: '建立或更新一份曲目表（cues.json）。只写场景与标签，不选曲。'
      + ' file 已存在时默认拒绝，不会覆盖已有选曲；要覆盖必须显式 mode=replace（会先备份）。'
      + ' 返回场景表，用来让用户核对切分。',
    parameters: INIT_PARAMS,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          file: { type: 'string' },
          cueCount: { type: 'number' },
          needBgmCount: { type: 'number' },
          warnings: { type: 'array', items: { type: 'string' } },
          unmatched: { type: 'array', items: { type: 'string' } },
          dropped: { type: 'array', items: { type: 'string' } },
          table: { type: 'string' },
          error: { type: 'string' },
          hint: { type: 'string' }
        }
      },
      render: (_a, v) => {
        if (!v.ok) return text(`❌ ${v.error ?? v.table}${v.hint ? `\n提示：${v.hint}` : ''}`)
        const notes = []
        if (v.warnings?.length) notes.push(`注意：${v.warnings.join('；')}`)
        if (v.unmatched?.length) {
          notes.push(`描述未命中标签：${v.unmatched.join('、')}（这些段先用 calm，建议手改目标）`)
        }
        if (v.dropped?.length) {
          notes.push(`词表外标签已丢弃：${v.dropped.join('；')}`)
        }
        return text(`${v.table}\n\n文件：${v.file}${notes.length ? `\n${notes.join('\n')}` : ''}`
          + '\n\n→ 清单已就绪。请到侧边栏「配乐工作台」挑歌：那里能试听、看听感分析与段内得分、直接定选。')
      }
    },
    async execute(args, exec) {
      try {
        const file = resolveFile(args.file, exec)
        const mode = args.mode ?? 'create'
        const exists = await fsp.access(file).then(() => true, () => false)

        if (exists && mode === 'create') {
          const current = await readSheet(file)
          const stats = summarize(current)
          throw new SheetError(
            `曲目表已存在：${file}`,
            `现有 ${stats.total} 段（已选 ${stats.picked}）。要追加用 mode=append，局部改用 mode=patch，整体重做用 mode=replace（会先写 .bak 备份）。`
          )
        }

        const check = validateCueInputs(args.cues)
        if (!check.ok) {
          throw new SheetError(`场景数组有错：\n- ${check.errors.join('\n- ')}`)
        }
        const vocab = await loadTags()
        const allowed = new Set(vocab.tags)

        let sheet
        if (exists && (mode === 'append' || mode === 'patch')) {
          sheet = await readSheet(file)
          if (args.directives) sheet.directives = args.directives
          const byId = new Map(sheet.cues.map((c) => [c.id, c]))
          let nextIndex = sheet.cues.length
          for (const input of args.cues) {
            const id = input.id ?? `c${String(nextIndex + 1).padStart(2, '0')}`
            const existing = byId.get(id)
            if (mode === 'append' && existing) {
              throw new SheetError(`id「${id}」已存在，append 不会覆盖。改用 patch。`)
            }
            const merged = {
              ...(existing ?? {}),
              id,
              scene: input.scene,
              trigger: input.trigger ?? existing?.trigger ?? '',
              need_bgm: input.need_bgm !== false,
              target: input.target ?? existing?.target,
              vocal: input.vocal ?? existing?.vocal ?? 'any',
              tags: input.tags ?? existing?.tags ?? null,
              wants: input.wants ?? [],
              avoids: input.avoids ?? []
            }
            if (!existing) {
              sheet.cues.push({ ...merged, state: 'ready', tags: null, candidates: [], picks: null, rejected: [], note: '' })
              nextIndex += 1
            } else {
              Object.assign(existing, merged)
              if (input.need_bgm === false) {
                existing.state = 'skipped'
                existing.candidates = []
                existing.picks = null
              } else if (existing.state === 'skipped') {
                existing.state = 'ready'
              }
            }
          }
        } else {
          sheet = emptySheet({ module: args.module, session: args.session, scope: args.scope })
          sheet.directives = args.directives ?? []
          sheet.cues = args.cues.map((input, i) => ({
            id: input.id ?? `c${String(i + 1).padStart(2, '0')}`,
            scene: input.scene,
            trigger: input.trigger ?? '',
            need_bgm: input.need_bgm !== false,
            state: input.need_bgm === false ? 'skipped' : 'ready',
            tags: input.tags ?? null,
            target: input.target,
            vocal: input.vocal ?? 'any',
            candidates: [],
            picks: null,
            rejected: [],
            note: '',
            wants: input.wants ?? [],
            avoids: input.avoids ?? []
          }))
        }

        if (args.source_path) {
          const abs = path.isAbsolute(args.source_path) ? args.source_path : path.resolve(path.dirname(file), args.source_path)
          const ok = await fsp.access(abs).then(() => true, () => false)
          if (!ok) throw new SheetError(`source_path 指向的文件不存在：${abs}`)
          sheet.source = path.relative(path.dirname(file), abs) || abs
        }

        // 目标：显式给了就按词表校验（词表外的标签丢弃并记录），没给就从描述推导；
        // 推导也没命中时 targetSource = 'none'，由返回值和界面明确提示「描述未命中标签」。
        sheet = normalizeSheet(sheet, file, vocab.tags)

        const unmatched = sheet.cues.filter((cue) => cue.targetSource === 'none').map((cue) => cue.id)
        const dropped = sheet.cues
          .filter((cue) => (cue.targetDropped ?? []).length > 0)
          .map((cue) => `${cue.id}（${cue.targetDropped.map(droppedHint).join('，')}）`)

        sheet.l1Shown = true
        await writeSheet(file, sheet)
        const stats = summarize(sheet)
        return {
          ok: true,
          file,
          cueCount: stats.total,
          needBgmCount: stats.total - stats.skipped,
          warnings: check.warnings,
          unmatched,
          dropped,
          table: renderTable(sheet, { mode: 'cues' })
        }
      } catch (error) {
        return fail(error)
      }
    }
  }
}

/**
 * 决定用哪些种子歌单。
 * 优先 settings.seedPlaylists；没配就从他自己的歌单里挑：
 *   ① 名字里带模组名的（通常是他为这个模组整理过的那张）
 *   ② 名字里带 bgm 的大杂烩池
 */
async function resolveSeeds(sheet, settings) {
  if (Array.isArray(settings.seedPlaylists) && settings.seedPlaylists.length > 0) {
    return settings.seedPlaylists
  }
  let mine = []
  try {
    mine = await ncm.myPlaylists({ limit: 100 })
  } catch {
    return []
  }
  const usable = mine.filter((p) => {
    const name = String(p.name ?? '')
    if (/华语|日系|ACG|其他|喜欢/.test(name)) return false
    return Number(p.trackCount ?? 0) >= 3
  })
  const moduleName = String(sheet.module ?? '').trim()
  const picked = []
  if (moduleName) {
    const exact = usable.filter((p) => String(p.name).includes(moduleName))
    picked.push(...exact.slice(0, 1))
  }
  const pool = usable
    .filter((p) => /bgm/i.test(String(p.name)))
    .sort((a, b) => Number(b.trackCount) - Number(a.trackCount))
  if (pool[0]) picked.push(pool[0])
  return picked.map((p) => String(p.id)).filter((id) => id && id !== 'undefined')
}

const FETCH_PARAMS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    file: { type: 'string', description: '曲目表路径。' },
    cue_ids: { type: 'array', items: { type: 'string' }, description: '只处理这些段；省略则处理所有待选的应配乐段。' },
    force: { type: 'boolean', description: '对已有候选的段也重新检索。' },
    limit: { type: 'number', description: '本次最多处理几段，默认 8。' }
  },
  required: ['file']
}

function createFetchTool() {
  return {
    name: 'bgm_fetch',
    description: '为待选段检索候选曲目并写回 cues.json。检索单元是「歌单」而不是歌曲搜索'
      + '（当前应用未被授权 search/song 接口）。每段最多留 8 首，按标签与全局要求打分排序。'
      + ' 单次最多处理 8 段，返回摘要而不是候选全文；要看候选请用 bgm_view。',
    parameters: FETCH_PARAMS,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          filled: { type: 'number' },
          insufficient: { type: 'array', items: { type: 'string' } },
          errors: { type: 'array', items: { type: 'string' } },
          quotaUsed: { type: 'number' },
          remaining: { type: 'number' },
          next: { type: 'string' },
          error: { type: 'string' },
          hint: { type: 'string' }
        }
      },
      render: (_a, v) => {
        if (!v.ok) return text(`❌ ${v.error ?? '检索失败'}${v.hint ? `\n提示：${v.hint}` : ''}`)
        const lines = [`已取候选：${v.filled} 段，调用 ${v.quotaUsed} 次`]
        if (v.insufficient?.length) lines.push(`候选不足：${v.insufficient.join('、')}`)
        if (v.errors?.length) lines.push(`失败：\n- ${v.errors.join('\n- ')}`)
        lines.push(v.next)
        return text(lines.join('\n'))
      }
    },
    async execute(args, exec) {
      const settings = await readSettings()
      const budget = { left: settings.fetchBudget }
      try {
        const file = resolveFile(args.file, exec)
        const sheet = await readSheet(file)
        const wanted = new Set(Array.isArray(args.cue_ids) ? args.cue_ids : [])
        const limit = Math.max(1, Math.min(Number(args.limit) || 8, 8))

        const targets = sheet.cues.filter((cue) => {
          if (!cue.need_bgm) return false
          if (wanted.size > 0 && !wanted.has(cue.id)) return false
          if (!args.force && cue.picks?.primary?.song_id) return false
          if (!args.force && cue.candidates.length > 0) return false
          if (cue.state === 'insufficient' && !args.force) return false
          return true
        }).slice(0, limit)

        if (targets.length === 0) {
          return { ok: true, filled: 0, insufficient: [], errors: [], quotaUsed: 0, remaining: budget.left, next: '没有需要检索的段。' }
        }

        const insufficient = []
        const errors = []
        const seeds = await resolveSeeds(sheet, settings)
        const baseTracks = seeds.length > 0 ? await loadSeedTracks(seeds, budget) : []
        // 别让别的段已经选过的曲子又出现在这一段的候选里
        const takenElsewhere = new Set(
          sheet.cues.filter((c) => c.picks?.primary?.song_id).map((c) => c.picks.primary.song_id)
        )
        const assigned = new Set()
        // 别的段已经在用的曲目也要降权：否则种子歌单里那几首会对每段都"高匹配"，
        // 同一首歌在七八段里重复出现（黑水溪实测就是这个问题）。
        for (const cue of sheet.cues) {
          if (targets.includes(cue)) continue
          for (const candidate of cue.candidates ?? []) assigned.add(candidate.song_id)
        }
        let filled = 0
        // 硬去重：已经在别的段出现过的曲目，本段不再给（除非剩下的太少）。
        // 只靠打分惩罚不够——种子歌单里那几首对每段都"高分"，最后同一首歌会铺满全表。
        const usedElsewhere = new Set()
        for (const cue of sheet.cues) {
          if (targets.includes(cue)) continue
          for (const candidate of cue.candidates ?? []) usedElsewhere.add(candidate.song_id)
        }

        for (const cue of targets) {
          if (budget.left <= 0) {
            errors.push('调用预算用尽，已停止')
            break
          }
          const { tracks, notes } = await collectForCue(cue, { baseTracks, seedPlaylists: seeds, budget })
          const minLen = Number(cue.tags?.min_len) >= 120 ? Number(cue.tags.min_len) : 90
          let candidates = prepareCandidates(tracks, {
            tags: cue.tags ?? {},
            directives: sheet.directives,
            limit: settings.candidateLimit,
            minSec: minLen,
            avoid: assigned,
            salt: cue.id
          })
          const fresh = candidates.filter((c) => !usedElsewhere.has(c.song_id))
          if (fresh.length >= 3) candidates = fresh
          for (const candidate of candidates) usedElsewhere.add(candidate.song_id)
          if (takenElsewhere.size > 0) {
            const filtered = candidates.filter((c) => !takenElsewhere.has(c.song_id))
            if (filtered.length > 0) candidates = filtered
          }
          for (const candidate of candidates.slice(0, 3)) assigned.add(candidate.song_id)
          if (candidates.length === 0) {
            cue.state = 'insufficient'
            cue.candidates = []
            cue.note = notes.join('；')
            insufficient.push(cue.id)
          } else {
            cue.state = 'ready'
            cue.candidates = candidates
            cue.note = notes.join('；')
            filled += 1
          }
        }

        await writeSheet(file, sheet)
        const pending = sheet.cues.filter((c) => c.need_bgm && !c.picks?.primary?.song_id).length
        return {
          ok: true,
          filled,
          insufficient,
          errors,
          quotaUsed: settings.fetchBudget - budget.left,
          remaining: budget.left,
          next: pending > 0
            ? `还有 ${pending} 段待检索；看候选用 bgm_view（带 cue_ids），选完用 bgm_pick。`
            : '所有应配乐段都有候选了，逐段看完用 bgm_pick 定选。'
        }
      } catch (error) {
        const code = String(error?.code ?? '')
        if (['300', '301', '1406', '1407', '1408', '2509'].includes(code)) {
          return {
            ...fail(error),
            ok: false,
            hint: code === '300'
              ? '这个接口没在你的应用权限包里，换不了。检索会退回歌单路径。'
              : '需要用户登录：在插件目录运行 node scripts/setup.mjs --login'
          }
        }
        return { ...fail(error), ok: false }
      }
    }
  }
}

const PICK_PARAMS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    file: { type: 'string', description: '曲目表路径。' },
    reset: { type: 'boolean', description: '先清空这些段的 rejected 记录。' },
    picks: {
      type: 'array',
      description: '每段的选择。primary.song_id 必须来自该段 candidates。',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          cue_id: { type: 'string' },
          primary: {
            type: 'object',
            additionalProperties: false,
            properties: {
              song_id: { type: 'number' },
              why: { type: 'string', description: '一句话理由，30 字以内，写具体特征不要写形容词。' }
            },
            required: ['song_id']
          },
          alts: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { song_id: { type: 'number' }, why: { type: 'string' } },
              required: ['song_id']
            }
          },
          reject: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { song_id: { type: 'number' }, reason: { type: 'string' } },
              required: ['song_id']
            }
          }
        },
        required: ['cue_id', 'primary']
      }
    }
  },
  required: ['file', 'picks']
}

function createPickTool() {
  return {
    name: 'bgm_pick',
    description: '提交选曲结果。song_id 必须来自该段已有的 candidates，否则整条拒绝并回传合法 id —— '
      + '这是防止凭空编造曲目的闸门。选完返回曲目表。',
    parameters: PICK_PARAMS,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          accepted: { type: 'number' },
          rejectedInputs: { type: 'array', items: { type: 'string' } },
          hints: { type: 'array', items: { type: 'string' } },
          table: { type: 'string' },
          error: { type: 'string' },
          hint: { type: 'string' }
        }
      },
      render: (_a, v) => {
        if (!v.ok) {
          const detail = v.rejectedInputs?.length ? `\n- ${v.rejectedInputs.join('\n- ')}` : ''
          return text(`❌ ${v.error ?? '提交被拒绝'}${detail}${v.hint ? `\n提示：${v.hint}` : ''}`)
        }
        return text(v.table)
      }
    },
    async execute(args, exec) {
      try {
        const file = resolveFile(args.file, exec)
        const sheet = await readSheet(file)
        const byId = new Map(sheet.cues.map((c) => [c.id, c]))
        const problems = []
        let accepted = 0

        for (const input of args.picks) {
          const cue = byId.get(input.cue_id)
          if (!cue) { problems.push(`找不到段 ${input.cue_id}`); continue }
          if (!cue.need_bgm) { problems.push(`段 ${input.cue_id} 标了不配乐`); continue }
          const legal = new Set(cue.candidates.map((c) => Number(c.song_id)))
          const primaryId = Number(input.primary?.song_id)
          if (!legal.has(primaryId)) {
            problems.push(`段 ${input.cue_id} 的 primary song_id=${primaryId} 不在候选里，合法 id：${[...legal].join(', ') || '(空)'}`)
            continue
          }
          const alts = []
          for (const alt of input.alts ?? []) {
            const id = Number(alt?.song_id)
            if (legal.has(id) && id !== primaryId) alts.push({ song_id: id, why: String(alt.why ?? '').slice(0, 30) })
          }
          if (args.reset) cue.rejected = []
          for (const rej of input.reject ?? []) {
            const id = Number(rej?.song_id)
            if (Number.isFinite(id)) cue.rejected.push({ song_id: id, reason: String(rej.reason ?? '').slice(0, 80), run: new Date().toISOString() })
          }
          // 存一份曲名快照：候选池被 force 重抓后，旧选的曲子会从 candidates 里消失，
          // 只留 song_id 的话报告和工作台就只剩一串数字。
          const picked = cue.candidates.find((c) => Number(c.song_id) === primaryId)
          const snapshot = {
            song_id: primaryId,
            title: picked?.title ?? '',
            artist: picked?.artist ?? '',
            why: String(input.primary?.why ?? '').slice(0, 30)
          }
          cue.picks = { primary: snapshot, alts }
          accepted += 1
        }

        await writeSheet(file, sheet)
        // 同一首歌被两段选中，通常说明候选池太窄，提示一下
        const seenAt = new Map()
        const hints = []
        sheet.cues.forEach((cue, index) => {
          const id = cue.picks?.primary?.song_id
          if (!id) return
          if (seenAt.has(id)) {
            const first = sheet.cues[seenAt.get(id)]
            hints.push(`第 ${seenAt.get(id) + 1} 段「${first.scene}」和第 ${index + 1} 段「${cue.scene}」选了同一首，建议换一首`)
          } else {
            seenAt.set(id, index)
          }
        })
        const table = renderTable(sheet, { mode: 'full' })
        return {
          ok: problems.length === 0,
          accepted,
          rejectedInputs: problems,
          hints,
          table: hints.length > 0 ? `${table}\n\n⚠️ ${hints.join('\n⚠️ ')}` : table
        }
      } catch (error) {
        return { ...fail(error), ok: false, accepted: 0, rejectedInputs: [], table: '' }
      }
    }
  }
}

const VIEW_PARAMS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    file: { type: 'string', description: '曲目表路径。' },
    scope: { type: 'string', enum: ['cues', 'full'], description: 'cues=只看场景切分；full=带曲目与备选数。默认 full。' },
    cue_ids: { type: 'array', items: { type: 'string' }, description: '只看这几段。' },
    max: { type: 'number', description: '最多显示几段。' }
  },
  required: ['file']
}

function createViewTool() {
  return {
    name: 'bgm_view',
    description: '只读：查看曲目表当前状态。scope=cues 出场景表（核对切分），scope=full 出曲目表（核对选曲）。',
    parameters: VIEW_PARAMS,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          table: { type: 'string' },
          status: { type: 'string' },
          error: { type: 'string' },
          hint: { type: 'string' }
        }
      },
      render: (_a, v) => text(v.ok ? `${v.table}\n\n${v.status}` : `❌ ${v.error ?? '读取失败'}${v.hint ? `\n提示：${v.hint}` : ''}`)
    },
    async execute(args, exec) {
      try {
        const file = resolveFile(args.file, exec)
        const sheet = await readSheet(file)
        const mode = args.scope ?? 'full'
        if (mode === 'cues' && sheet.l1Shown !== true) sheet.l1Shown = true
        const stats = summarize(sheet)
        const pending = sheet.cues.filter((c) => c.need_bgm && !c.picks?.primary?.song_id)
        return {
          ok: true,
          table: renderTable(sheet, { mode, cueIds: args.cue_ids, max: args.max }),
          status: `进度：共 ${stats.total} 段，已选 ${stats.picked}，有候选待选 ${stats.candidates}，候选不足 ${stats.insufficient}，不配乐 ${stats.skipped}。`
            + (pending.length > 0 ? `\n待选：${pending.map((c) => c.id).join('、')}` : '')
        }
      } catch (error) {
        return { ...fail(error), ok: false, table: '', status: '' }
      }
    }
  }
}

const COMMIT_PARAMS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    file: { type: 'string', description: '曲目表路径。' },
    dry_run: { type: 'boolean', description: '只算不改：报告会新建/追加多少首，不创建歌单。' }
  },
  required: ['file']
}

function createCommitTool() {
  return {
    name: 'bgm_commit',
    description: '把选好的曲目落到网易云：新建（或复用）一个歌单，把主选曲目按段序加进去，'
      + '同时导出 review.md / playlist.txt / playlist.csv。幂等：曲目表里记了 playlist_id 就复用它，只补没加过的曲子。'
      + ' dry_run 只报告不写入。',
    parameters: COMMIT_PARAMS,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          playlist: { type: 'string' },
          playlistId: { type: 'string' },
          added: { type: 'number' },
          total: { type: 'number' },
          files: { type: 'array', items: { type: 'string' } },
          missing: { type: 'array', items: { type: 'string' } },
          error: { type: 'string' },
          hint: { type: 'string' }
        }
      },
      render: (_a, v) => {
        if (!v.ok) return text(`❌ ${v.error ?? '导出失败'}${v.hint ? `\n提示：${v.hint}` : ''}`)
        const lines = [`歌单：${v.playlist ?? '(未写入)'}`, `曲目：${v.total} 首，本次新增 ${v.added} 首`]
        if (v.playlistId) lines.push(`歌单 ID：${v.playlistId}`)
        if (v.files?.length) lines.push('', '导出文件：', ...v.files.map((f) => `- ${f}`))
        if (v.missing?.length) lines.push('', `还没选的段：${v.missing.join('、')}`)
        return text(lines.join('\n'))
      }
    },
    async execute(args, exec) {
      try {
        const file = resolveFile(args.file, exec)
        const sheet = await readSheet(file)
        const pending = sheet.cues.filter((c) => c.need_bgm && !c.picks?.primary?.song_id).map((c) => c.id)
        const picked = sheet.cues.filter((c) => cueStatus(c) === 'picked')
        if (picked.length === 0) throw new SheetError('还没有任何一段完成选曲，先用 bgm_pick。')

        const encrypted = []
        for (const cue of picked) {
          const track = cue.candidates.find((c) => c.song_id === cue.picks.primary.song_id)
          if (track?.encrypted_id) encrypted.push(track.encrypted_id)
        }

        // 命名：日期-模组-BGM（用户 2026-11-16 指定）
        const d = new Date()
        const p2 = (n) => String(n).padStart(2, '0')
        const name = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${sheet.module || '跑团'}-BGM`
        const paths = sheetPaths(file)

        if (args.dry_run) {
          return { ok: true, playlist: name, playlistId: sheet.playlist_id ?? '', added: encrypted.length, total: picked.length, files: [], missing: pending }
        }

        // 1. 歌单：有记录就复用，否则新建
        let playlistId = sheet.playlist_id || ''
        let jumpUrl = ''
        if (!playlistId) {
          const created = await ncm.createPlaylist(name)
          playlistId = created?.id ?? created?.playlistId ?? created?.playlist?.id ?? ''
          jumpUrl = String(created?.jumpUrl ?? '')
          if (!playlistId) throw new SheetError('歌单已创建但没拿到 ID，无法继续加曲', JSON.stringify(created).slice(0, 200))
          sheet.playlist_id = playlistId
          sheet.playlist_name = name
          await writeSheet(file, sheet)
        } else if (sheet.playlist_name !== name) {
          // 已有歌单但名字是旧格式：顺手改名，免得历史包袱留在他账号里
          try {
            await ncm.renamePlaylist(playlistId, name)
            sheet.playlist_name = name
            await writeSheet(file, sheet)
          } catch { /* 改名失败不影响加曲 */ }
        }

        // 2. 差异加曲
        const existing = await ncm.playlistTracks(playlistId, { limit: 500 })
        const existingHex = new Set(existing.map((t) => t.id).filter(Boolean))
        const toAdd = [...new Set(encrypted)].filter((id) => !existingHex.has(id))
        if (toAdd.length > 0) await ncm.addPlaylistTracks(playlistId, toAdd)

        // 3. 导出三件套
        await ncm.atomicWrite(paths.review, renderReview(sheet))
        await ncm.atomicWrite(paths.text, renderPlaylistText(sheet))
        await ncm.atomicWrite(paths.csv, renderPlaylistCsv(sheet))
        sheet.export = { at: new Date().toISOString(), tracks: picked.length, playlistId }
        await writeSheet(file, sheet)

        await recordHistory({
          file,
          module: sheet.module ?? '',
          scope: sheet.scope ?? '',
          session: sheet.session ?? null,
          playlistName: name,
          playlistId,
          tracks: picked.length,
          jumpUrl
        })

        return {
          ok: true,
          playlist: name,
          playlistId,
          added: toAdd.length,
          total: picked.length,
          files: [paths.review, paths.text, paths.csv],
          missing: pending
        }
      } catch (error) {
        const code = String(error?.code ?? '')
        return {
          ...fail(error),
          ok: false,
          hint: code === 'cli-not-logged-in'
            ? '需要先登录 ncm-cli：node scripts/setup.mjs --cli-login（或直接跑 ncm-cli login）'
            : (error?.hint ?? '')
        }
      }
    }
  }
}

// ------------------------------------------------------------------ 自动打标

const TAG_PARAMS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    file: { type: 'string', description: '曲目表路径。' },
    cue_ids: { type: 'array', items: { type: 'string' }, description: '只处理这几段；省略则处理所有有候选的段。' },
    per_cue: { type: 'number', description: '每段打前几首候选，默认 8（覆盖一整套默认候选）。' },
    max_songs: { type: 'number', description: '本次最多分析几首，默认 24。超出部分留在 remaining 里，再调一次继续。' },
    force: { type: 'boolean', description: '已经打过标的也重跑。' }
  },
  required: ['file']
}

function createTagTool() {
  return {
    name: 'bgm_tag',
    description: '给候选曲做听感分析：调本地 music2emo（E:\\Software\\audioml-m2e），'
      + '输出 MTG-Jamendo 原生标签的概率向量（dark / dramatic / calm / …）与 valence/arousal。'
      + '每算完一首立即入库，中断最多损失当前一首；每次默认最多 24 首（max_songs），'
      + '没跑完会返回 partial / remaining，再调一次继续。',
    parameters: TAG_PARAMS,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          analyzed: { type: 'number' },
          cached: { type: 'number' },
          tried: { type: 'number' },
          failed: { type: 'number' },
          cues: { type: 'number' },
          partial: { type: 'boolean' },
          remaining: { type: 'number' },
          stopReason: { type: 'string' },
          batches: { type: 'number' },
          store: { type: 'string' },
          storeFailed: { type: 'number' },
          error: { type: 'string' },
          hint: { type: 'string' },
          checks: { type: 'array', items: { type: 'object', additionalProperties: true } }
        }
      },
      render: (_a, v) => {
        if (!v.ok) {
          const lines = [`❌ ${v.error ?? '打标失败'}`]
          for (const check of v.checks ?? []) lines.push(`- ${check.name}: ${check.ok ? 'ok' : `缺 ${check.path}`}`)
          if (v.hint) lines.push(`提示：${v.hint}`)
          return text(lines.join('\n'))
        }
        const lines = [`已分析 ${v.analyzed} 首（尝试 ${v.tried} 首，${v.cues} 段；缓存命中 ${v.cached ?? 0}）`]
        if (v.failed > 0) lines.push(`其中 ${v.failed} 首失败（拿不到音频、解码失败或超时）`)
        if (v.remaining > 0) {
          const reason = {
            budget: '本次预算用完',
            timeout: '有单首超时',
            max_songs: '本次上限',
            crash: '分析进程提前退出',
            fatal: '分析进程报错',
            incomplete: '有歌没返回结果'
          }[v.stopReason] ?? '没跑完'
          lines.push(`还剩 ${v.remaining} 首（${reason}，再调一次继续）`)
        }
        if (v.error) lines.push(`⚠️ ${v.error}`)
        if (v.store && v.store !== 'sqlite') lines.push('⚠️ analysis.db 不可用，结果已退回 JSON 缓存')
        if (v.storeFailed > 0) lines.push(`⚠️ ${v.storeFailed} 首写缓存失败，只在本次返回里`)
        return text(lines.join('\n'))
      }
    },
    async execute(args, exec) {
      try {
        const file = resolveFile(args.file, exec)
        const sheet = await readSheet(file)
        const cueIds = Array.isArray(args.cue_ids) && args.cue_ids.length > 0 ? new Set(args.cue_ids.map(String)) : null
        const perCue = Math.max(1, Math.min(20, Number(args.per_cue) || 8))
        const maxSongs = Math.max(1, Math.min(200, Math.floor(Number(args.max_songs) || 24)))
        const targets = sheet.cues.filter((cue) => (!cueIds || cueIds.has(cue.id)) && (cue.candidates?.length ?? 0) > 0)
        if (targets.length === 0) throw new SheetError('这几段还没有候选曲，先用 bgm_fetch。')

        const allTracks = []
        const seen = new Set()
        for (const cue of targets) {
          for (const candidate of cue.candidates.slice(0, perCue)) {
            // 已有可用分析就跳过（除非 force）；同一首歌在全表只分析一次
            if (!args.force && candidate.analysis?.probs) continue
            const key = String(candidate.song_id)
            if (seen.has(key)) continue
            seen.add(key)
            allTracks.push({ song_id: candidate.song_id, title: candidate.title })
          }
        }
        const tracks = allTracks.slice(0, maxSongs)
        const deferred = allTracks.length - tracks.length
        const empty = {
          ok: true, analyzed: 0, cached: 0, tried: 0, failed: 0, cues: targets.length,
          partial: false, remaining: 0, stopReason: '', batches: 0, store: 'sqlite', storeFailed: 0
        }
        if (tracks.length === 0) return empty

        const health = await engineHealth()
        if (!health.ok) {
          return { ok: false, error: '听感分析环境不完整', checks: health.checks, hint: '按 docs/DESIGN-v4.md §7.2 安装 music2emo，或改 settings.json 的 analysis 段' }
        }

        const run = await analyzeTracks(tracks, { force: args.force })
        if (!run.ok) return { ok: false, error: run.error, hint: '检查 E:\\Software\\audioml-m2e；首次分析会加载 MERT' }

        // 已落库的结果（含本次新增和命中的）都要写回曲目表
        const written = applyAnalysis(sheet.cues, run.results)
        if (written > 0) await writeSheet(file, sheet)
        const remaining = deferred + (run.remaining ?? 0)
        let stopReason = run.stopReason ?? ''
        if (!stopReason && deferred > 0) stopReason = 'max_songs'
        return {
          ok: true,
          analyzed: run.analyzed ?? 0,
          cached: run.cached ?? 0,
          tried: tracks.length,
          failed: run.failed ?? 0,
          cues: targets.length,
          partial: remaining > 0,
          remaining,
          stopReason,
          batches: run.batches ?? 0,
          store: run.store ?? 'sqlite',
          storeFailed: run.storeFailed ?? 0,
          error: run.error || ''
        }
      } catch (error) {
        if (error instanceof SheetError) return { ...fail(error), ok: false }
        throw error
      }
    }
  }
}

// ------------------------------------------------------------------ 挂载

export function apply(ctx) {
  if (typeof ctx?.tools?.register !== 'function') {
    ctx?.logger?.warn?.('bgm-prep: tools service 不可用，工具未注册')
    return
  }
  const logger = ctx?.logger ?? console
  const tools = {
    init: createInitTool(),
    fetch: createFetchTool(),
    pick: createPickTool(),
    view: createViewTool(),
    commit: createCommitTool(),
    tag: createTagTool()
  }
  // 每次成功执行都记住这份曲目表，工作台默认打开它
  for (const [name, tool] of Object.entries(tools)) {
    tools[name] = {
      ...tool,
      async execute(args, exec) {
        const result = await tool.execute(args, exec)
        if (result?.ok && typeof args?.file === 'string') await rememberSheetFile(args.file)
        return result
      }
    }
  }
  for (const tool of Object.values(tools)) ctx.tools.register(tool)
  logger.info?.('bgm-prep: 已注册 bgm_init / bgm_fetch / bgm_pick / bgm_view / bgm_commit / bgm_tag')

  // 工作台：Host 路由 + 音频代理。webServer 不可用时插件仍然可用，只是没有界面。
  const workbench = new Workbench({ getTools: () => tools, logger })
  if (typeof ctx?.webServer?.register !== 'function') {
    logger.warn?.('bgm-prep: webServer 不可用，工作台未挂载')
    return
  }
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (request, response) => {
      // 这个 handler 跑在 DSH 宿主进程里：任何逃逸的异常都会直接带走宿主，
      // 所以整段必须自己兜住，绝不往外抛。
      try {
        if (!isTrusted(request)) {
          writeJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
          return
        }
        await workbench.handle(request, response)
      } catch (error) {
        logger.warn?.(`bgm-prep route: ${String(error?.message ?? error)}`)
        try {
          if (!response.headersSent) writeJson(response, 500, { ok: false, error: { code: 'route-failed', message: String(error?.message ?? error) } })
          else response.destroy()
        } catch { /* 已经不可写，忽略 */ }
      }
    }
  }), 'bgm-prep: workbench route')

  ctx.effect(() => () => { /* 无长驻资源需要释放 */ }, 'bgm-prep: workbench lifecycle')
  logger.info?.(`bgm-prep: 工作台挂在 ${ROUTE_PREFIX}`)
}















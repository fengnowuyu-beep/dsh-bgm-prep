// bgm_fetch 必须在等待 ncm-cli 时让出事件循环。
//
// 背景（2026-11-19 事故）：cli() 原来用 spawnSync，子进程运行期间整个 Node
// 事件循环被钉死；插件和 DSH 的 Web 服务同进程，所以一次 bgm_fetch 会让
// 「切对话 → 载入历史」全部卡住，用户只能强杀 DSH。
//
// 这里用假 CLI 的 FAKE_CLI_DELAY_MS 模拟慢网络：
//   · 异步实现 —— 心跳照常跳，最大间隔只有几十毫秒
//   · spawnSync —— 每次调用直接把循环按住 400ms＋，最大间隔必然超过阈值

import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

process.env.NCM_CLI = fileURLToPath(new URL('../tools/fake-cli.mjs', import.meta.url))
process.env.DSH_HOME = await fsp.mkdtemp(path.join(os.tmpdir(), 'bgm-nonblock-home-'))

const { apply } = await import('../lib/index.js')
const { clearCliCache } = await import('../lib/ncm.js')

const CLI_DELAY_MS = 400
// 一次同步调用至少占到 CLI_DELAY_MS，再加进程启动；300ms 能把两种实现干净分开
const MAX_GAP_MS = 300

function loadTools() {
  const tools = new Map()
  apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: {} })
  return tools
}

async function makeSheet(prefix) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `bgm-${prefix}-`))
  const file = path.join(dir, 'bgm', 'act1.cues.json')
  const tools = loadTools()
  const exec = { agent: { session: { header: { cwd: dir } } } }
  const init = await tools.get('bgm_init').execute({
    file,
    module: 'mock',
    session: 1,
    scope: 'act1',
    cues: [
      { scene: '地窖 · 石阶', need_bgm: true, tags: { valence: 'dark', energy: 'static', texture: ['drone'], vocal: 'none' } },
      { scene: '码头 · 夜', need_bgm: true, tags: { valence: 'dark', energy: 'static', texture: ['drone'], vocal: 'none' } }
    ]
  }, exec)
  assert.equal(init.ok, true, JSON.stringify(init))
  return { file, tools, exec }
}

test('bgm_fetch 等待 CLI 期间不阻塞事件循环', async () => {
  clearCliCache()
  process.env.FAKE_CLI_DELAY_MS = String(CLI_DELAY_MS)
  try {
    const { file, tools, exec } = await makeSheet('nonblock')

    // 20ms 心跳：只要事件循环被按住，间隔就会出现一个大坑
    const beats = []
    const heartbeat = setInterval(() => beats.push(Date.now()), 20)
    const started = Date.now()
    let result
    try {
      result = await tools.get('bgm_fetch').execute({ file }, exec)
    } finally {
      clearInterval(heartbeat)
    }
    const finished = Date.now()
    const elapsed = finished - started

    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.filled, 2, JSON.stringify(result))

    // 确认延时真的生效了，否则这个用例等于没测
    assert.ok(elapsed > CLI_DELAY_MS, `CLI 延时没生效？elapsed=${elapsed}ms`)

    // 首尾也要算进时间线：整段被同步按住时心跳一次都跳不出来，
    // 只看 beats 内部间隔会得到 0，反而漏判。
    const timeline = [started, ...beats, finished]
    let maxGap = 0
    for (let i = 1; i < timeline.length; i += 1) maxGap = Math.max(maxGap, timeline[i] - timeline[i - 1])
    assert.ok(beats.length > 0, '心跳一次都没跳，事件循环全程被占住')
    assert.ok(
      maxGap < MAX_GAP_MS,
      `事件循环被阻塞了 ${maxGap}ms（上限 ${MAX_GAP_MS}ms）—— cli() 是不是又用回 spawnSync 了？`
    )
  } finally {
    delete process.env.FAKE_CLI_DELAY_MS
  }
})

test('相同检索词第二轮直接命中缓存，不再起进程', async () => {
  clearCliCache()
  const logFile = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'bgm-cachelog-')), 'cli.log')
  process.env.FAKE_CLI_LOG = logFile
  delete process.env.FAKE_CLI_DELAY_MS
  try {
    const { file, tools, exec } = await makeSheet('cache')

    const first = await tools.get('bgm_fetch').execute({ file }, exec)
    assert.equal(first.ok, true, JSON.stringify(first))
    const afterFirst = (await fsp.readFile(logFile, 'utf8')).trim().split('\n').filter(Boolean)
    assert.ok(afterFirst.length > 0, '假 CLI 一次都没被调用？')
    assert.ok(
      afterFirst.some((line) => line.startsWith('search playlist')),
      `没走歌单检索：${afterFirst.join(' | ')}`
    )

    // force 重抓走的是同一批检索词，应该全部命中缓存
    const second = await tools.get('bgm_fetch').execute({ file, force: true }, exec)
    assert.equal(second.ok, true, JSON.stringify(second))
    const afterSecond = (await fsp.readFile(logFile, 'utf8')).trim().split('\n').filter(Boolean)

    assert.equal(
      afterSecond.length,
      afterFirst.length,
      `第二轮不该再起进程，却又调了 ${afterSecond.length - afterFirst.length} 次：\n${afterSecond.slice(afterFirst.length).join('\n')}`
    )
  } finally {
    delete process.env.FAKE_CLI_LOG
  }
})

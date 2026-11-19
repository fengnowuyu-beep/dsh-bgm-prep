import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// 每个测试文件单独进程：DSH_HOME 指到临时目录，别碰真实分析库。
const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'bgm-analyze-'))
process.env.DSH_HOME = home

const fakeScript = fileURLToPath(new URL('./fixtures/fake-analyze.mjs', import.meta.url))
const fakeLog = path.join(home, 'fake.log')
const codeDir = path.join(home, 'code')
const modelsDir = path.join(home, 'models')
await fsp.mkdir(codeDir, { recursive: true })
await fsp.mkdir(modelsDir, { recursive: true })
await fsp.mkdir(path.join(home, 'bgm-prep'), { recursive: true })

const { analyzeTracks, deriveBudgetMs } = await import('../lib/analyze.js')
const { readAnalysis, writeAnalysis } = await import('../lib/analysisDb.js')

// 取播放直链要打网易云；测试里把它换成固定 URL，不真的发请求。
const realFetch = globalThis.fetch
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  json: async () => ({ data: [{ url: 'https://example.test/audio.mp3' }] })
})

async function configure(extra = {}) {
  const analysis = {
    engine: 'music2emo',
    python: process.execPath,
    script: fakeScript,
    code: codeDir,
    models: modelsDir,
    version: 'test-v1',
    perSongTimeoutMs: 5000,
    totalBudgetMs: 60000,
    batchSize: 8,
    threads: 2,
    audioCacheMaxBytes: 1024 * 1024 * 1024,
    // 默认关掉人声识别：老用例只关心情绪分析，避免多起一个 CLAP 进程
    vocal: { enabled: false },
    ...extra
  }
  await fsp.writeFile(path.join(home, 'bgm-prep', 'settings.json'), JSON.stringify({ analysis }, null, 2), 'utf8')
}

async function clearFakeLog() {
  await fsp.rm(fakeLog, { force: true })
}

async function readFakeLog() {
  try {
    const text = await fsp.readFile(fakeLog, 'utf8')
    return text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  } catch {
    return []
  }
}

function track(id) {
  return { song_id: id, title: `song-${id}` }
}

test('NDJSON：逐首解析并写入 analysis.db', async () => {
  await configure()
  process.env.FAKE_MODE = 'ok'
  process.env.FAKE_LOG = fakeLog
  await clearFakeLog()

  const tracks = [track(1001), track(1002), track(1003)]
  const run = await analyzeTracks(tracks)

  assert.equal(run.ok, true)
  assert.equal(run.analyzed, 3)
  assert.equal(run.failed, 0)
  assert.equal(run.cached, 0)
  assert.equal(run.batches, 1)
  assert.equal(run.partial, false)
  assert.equal(run.remaining, 0)
  assert.equal(run.stopReason, '')
  assert.equal(run.store, 'sqlite')
  for (const item of tracks) {
    const hit = await readAnalysis(item.song_id, 'test-v1')
    assert.ok(hit, `song ${item.song_id} 应已落库`)
    assert.equal(hit.probs.dark, 0.5)
    assert.equal(hit.va.valence, 3)
  }
  const log = await readFakeLog()
  assert.equal(log.length, 1)
  assert.equal(log[0].count, 3)
})

test('partial：总预算到点，已落库的不丢', async () => {
  await configure({ perSongTimeoutMs: 60000, totalBudgetMs: 2500 })
  process.env.FAKE_MODE = 'budget'
  process.env.FAKE_LOG = fakeLog
  await clearFakeLog()

  const run = await analyzeTracks([track(2001), track(2002), track(2003), track(2004)])

  assert.equal(run.ok, true)
  assert.equal(run.analyzed, 1)
  assert.equal(run.partial, true)
  assert.equal(run.remaining, 3)
  assert.equal(run.stopReason, 'budget')
  assert.ok(await readAnalysis(2001, 'test-v1'), '被杀之前算完的那首必须已经落库')
  assert.equal(await readAnalysis(2002, 'test-v1'), null)
})

test('批次切分：batchSize 决定 spawn 次数', async () => {
  await configure({ batchSize: 2, perSongTimeoutMs: 10000, totalBudgetMs: 120000 })
  process.env.FAKE_MODE = 'ok'
  process.env.FAKE_LOG = fakeLog
  await clearFakeLog()

  const tracks = Array.from({ length: 5 }, (_, i) => track(3000 + i))
  const run = await analyzeTracks(tracks)

  assert.equal(run.ok, true)
  assert.equal(run.analyzed, 5)
  assert.equal(run.batches, 3)
  const log = await readFakeLog()
  assert.deepEqual(log.map((entry) => entry.count), [2, 2, 1])
})

test('单首超时：只放弃这一首，剩下的重开一批继续', async () => {
  await configure({ perSongTimeoutMs: 1500, totalBudgetMs: 60000, batchSize: 8 })
  process.env.FAKE_MODE = 'timeout'
  process.env.FAKE_LOG = fakeLog
  await clearFakeLog()

  const run = await analyzeTracks([track(4001), track(4002), track(4003)])

  assert.equal(run.ok, true)
  assert.equal(run.analyzed, 2)
  assert.equal(run.failed, 1)
  assert.equal(run.batches, 2, '超时后应带着剩下的歌重开一批')
  assert.equal(run.stopReason, 'timeout')
  assert.equal(run.partial, false)
  assert.equal(run.remaining, 0)
  assert.match(String(run.results['4002'].error), /超时/)
  assert.ok(await readAnalysis(4001, 'test-v1'))
  assert.ok(await readAnalysis(4003, 'test-v1'))
  assert.equal(await readAnalysis(4002, 'test-v1'), null)
})

test('老版单 JSON 输出仍能兜底', async () => {
  await configure()
  process.env.FAKE_MODE = 'legacy'
  process.env.FAKE_LOG = fakeLog
  await clearFakeLog()

  const run = await analyzeTracks([track(5001), track(5002)])

  assert.equal(run.ok, true)
  assert.equal(run.analyzed, 2)
  assert.equal(run.batches, 1)
  assert.ok(await readAnalysis(5001, 'test-v1'))
  assert.ok(await readAnalysis(5002, 'test-v1'))
})

test('已入库的歌不再 spawn 分析进程', async () => {
  await configure()
  process.env.FAKE_MODE = 'ok'
  process.env.FAKE_LOG = fakeLog
  await clearFakeLog()
  const payload = {
    probs: { dark: 0.9 },
    va: { valence: 1, arousal: 8 },
    stability: null,
    engine: 'test-v1',
    at: '2026-11-18T00:00:00.000Z'
  }
  await writeAnalysis(6001, 'test-v1', payload)
  await writeAnalysis(6002, 'test-v1', payload)

  const run = await analyzeTracks([track(6001), track(6002)])

  assert.equal(run.ok, true)
  assert.equal(run.analyzed, 0)
  assert.equal(run.cached, 2)
  assert.equal(run.batches, 0)
  assert.deepEqual(await readFakeLog(), [], '缓存命中不该启动 Python')
})

test('音频缓存与线程数传给 Python', async () => {
  await configure({ audioCacheMaxBytes: 5 * 1024 * 1024 * 1024, threads: 2 })
  process.env.FAKE_MODE = 'ok'
  process.env.FAKE_LOG = fakeLog
  await clearFakeLog()

  await analyzeTracks([track(7001)])

  const log = await readFakeLog()
  assert.equal(log.length, 1)
  assert.equal(log[0].cache.dir, path.join(home, 'bgm-prep', 'cache', 'audio'))
  assert.equal(log[0].cache.version, 'test-v1')
  assert.equal(log[0].cache.max_bytes, 5 * 1024 * 1024 * 1024)
  assert.equal(log[0].cache.concurrency, 3)
  assert.equal(log[0].threads, '2')
})

test('模型加载失败：没有任何结果时按失败返回', async () => {
  await configure()
  process.env.FAKE_MODE = 'fatal'
  process.env.FAKE_LOG = fakeLog
  await clearFakeLog()

  const run = await analyzeTracks([track(8001)])

  assert.equal(run.ok, false)
  assert.match(String(run.error), /fake model load failure/)
})

test('预算推导：perSong × n × 1.5，封顶 totalBudgetMs', () => {
  assert.equal(deriveBudgetMs(1, { perSongTimeoutMs: 180000, totalBudgetMs: 5400000 }), 270000)
  assert.equal(deriveBudgetMs(8, { perSongTimeoutMs: 180000, totalBudgetMs: 5400000 }), 2160000)
  assert.equal(deriveBudgetMs(56, { perSongTimeoutMs: 180000, totalBudgetMs: 5400000 }), 5400000)
})

// ---------------------------------------------------------------- 真实 Python 缓存

const venvPython = 'E:\\Software\\audioml-m2e\\Scripts\\python.exe'
const hasVenv = fs.existsSync(venvPython)

function makeWav() {
  const sampleRate = 24000
  const seconds = 4
  const samples = sampleRate * seconds
  const dataSize = samples * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < samples; i += 1) {
    const value = Math.round(8000 * Math.sin((2 * Math.PI * 220 * i) / sampleRate))
    buffer.writeInt16LE(value, 44 + i * 2)
  }
  return buffer
}

function runProcess(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, options)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => resolve({ status: -1, stdout, stderr: String(error) }))
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
}

test('audio cache：同一首歌第二次不再下载', { skip: hasVenv ? false : '本机没有 music2emo venv' }, async () => {
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'bgm-cache-'))
  const cacheDir = path.join(work, 'cache')
  const wav = makeWav()
  let hits = 0
  const server = http.createServer((req, res) => {
    hits += 1
    res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': String(wav.length) })
    res.end(wav)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/song.wav`

  const driver = [
    'import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("m2e_analyze", sys.argv[1])',
    'mod = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(mod)',
    'cache_dir, url = sys.argv[2], sys.argv[3]',
    'first = mod._ensure_wav(url, mod._cache_file(cache_dir, 8801, "test-v1"))',
    'second = mod._ensure_wav(url, mod._cache_file(cache_dir, 8801, "test-v1"))',
    'print(json.dumps({"first": first, "second": second}))'
  ].join('\n')
  const driverPath = path.join(work, 'driver.py')
  await fsp.writeFile(driverPath, driver, 'utf8')

  const result = await runProcess(venvPython, [
    driverPath,
    fileURLToPath(new URL('../tools/m2e/analyze.py', import.meta.url)),
    cacheDir,
    url
  ], {
    encoding: 'utf8',
    timeout: 180000,
    env: { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' }
  })
  server.close()

  assert.equal(result.status, 0, `python 退出码 ${result.status}：${result.stderr?.slice(-400)}`)
  assert.equal(hits, 1, '第二次调用应命中缓存，不再发 HTTP 请求')
  const parsed = JSON.parse(result.stdout.trim().split('\n').pop())
  assert.equal(parsed.first, parsed.second)
  assert.ok(fs.existsSync(parsed.first), '缓存文件应存在')
  assert.ok(fs.statSync(parsed.first).size > 100000)
})

test.after(() => {
  globalThis.fetch = realFetch
})
test('人声识别：存量分析缺 vocal 时只补跑 CLAP，不重算情绪', async () => {
  await configure({ vocal: { enabled: true, penalty: 0.25, threshold: 0.25 } })
  process.env.FAKE_MODE = 'ok'
  process.env.FAKE_LOG = fakeLog
  await clearFakeLog()
  await writeAnalysis(9001, 'test-v1', {
    probs: { dark: 0.5 }, va: { valence: 3, arousal: 5 }, stability: null, vocal: null,
    engine: 'test-v1', at: new Date().toISOString()
  })

  const run = await analyzeTracks([track(9001)])
  assert.equal(run.ok, true)
  assert.equal(run.cached, 1)
  assert.equal(run.vocalFilled, 1)
  assert.equal(run.results['9001'].vocal, 0.7)

  const hit = await readAnalysis(9001, 'test-v1')
  assert.equal(hit.vocal, 0.7)

  const log = await readFakeLog()
  assert.deepEqual(log.map((l) => l.jobMode), ['vocal'], '只应起一次人声批次')
})

test('人声识别：新歌分析时一并写回 vocal', async () => {
  await configure({ vocal: { enabled: true } })
  process.env.FAKE_MODE = 'ok'
  process.env.FAKE_LOG = fakeLog
  await clearFakeLog()

  const run = await analyzeTracks([track(9101)])
  assert.equal(run.ok, true)
  assert.equal(run.results['9101'].vocal, 0.7)
  const hit = await readAnalysis(9101, 'test-v1')
  assert.equal(hit.vocal, 0.7)
  const log = await readFakeLog()
  assert.deepEqual(log.map((l) => l.jobMode), ['full'], '不需要额外的人声批次')
})

test('默认只分析前 120 秒，配置成 0 时按整曲', async () => {
  await configure()
  process.env.FAKE_MODE = 'ok'
  process.env.FAKE_LOG = fakeLog
  await clearFakeLog()

  const run = await analyzeTracks([track(9201)])
  assert.equal(run.ok, true, JSON.stringify(run))
  let log = await readFakeLog()
  assert.equal(log[0].clip, 120, '默认裁剪到 120 秒')

  await configure({ clipSeconds: 0 })
  await clearFakeLog()
  await analyzeTracks([track(9202)])
  log = await readFakeLog()
  assert.equal(log[0].clip, 0, '显式配 0 = 整曲')
})

test('分析用 320k，试听不受影响', async () => {
  const { engineConfig } = await import('../lib/analyze.js')
  const config = await engineConfig()
  assert.equal(config.quality, 'high')
  // 试听走 ui.js 的 songUrl 默认值（lossless），与这里无关
})

test('熔断：连续失败到上限就停，不把剩下的歌一个个等超时', async () => {
  await configure({ breakerLimit: 3, batchSize: 2 })
  process.env.FAKE_MODE = 'fail-all'
  await clearFakeLog()

  const tracks = [track(9301), track(9302), track(9303), track(9304), track(9305), track(9306)]
  const run = await analyzeTracks(tracks)
  assert.equal(run.ok, true, JSON.stringify(run))
  assert.equal(run.stopReason, 'breaker')
  assert.equal(run.failed, 4, '第一批 2 首 + 第二批 2 首后触发熔断')
  assert.equal(run.remaining, 2, '最后两首根本没尝试')
})

test('失败负缓存：两次失败后进冷却，第三次直接跳过', async () => {
  await configure({ breakerLimit: 8, batchSize: 8 })
  process.env.FAKE_MODE = 'fail-all'

  const tracks = [track(9401), track(9402)]
  const first = await analyzeTracks(tracks)
  assert.equal(first.failed, 2)
  assert.equal(first.skippedCooldown, 0)

  const second = await analyzeTracks(tracks)
  assert.equal(second.failed, 2, '第二次仍然尝试（还没到两次门槛）')

  const third = await analyzeTracks(tracks)
  assert.equal(third.failed, 0)
  assert.equal(third.skippedCooldown, 2, '冷却期内不再为这两首等超时')
  assert.equal(third.remaining, 0)
  assert.equal(third.retryLater, 2)
})

test('分析成功后清掉失败记录，下次照常尝试', async () => {
  await configure({ breakerLimit: 8 })
  process.env.FAKE_MODE = 'fail-all'
  await analyzeTracks([track(9501)])
  await analyzeTracks([track(9501)])

  const { readFailure } = await import('../lib/analysisDb.js')
  const cooling = await readFailure(9501, 'test-v1')
  assert.ok(cooling?.retryAfter, '两次失败后应写入冷却截止时间')

  // 用 force 绕过冷却，让这次成功，然后失败记录应被清掉
  process.env.FAKE_MODE = 'ok'
  const ok = await analyzeTracks([track(9501)], { force: true })
  assert.equal(ok.analyzed, 1)
  const cleared = await readFailure(9501, 'test-v1')
  assert.equal(cleared, null)
})

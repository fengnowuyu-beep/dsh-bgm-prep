import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// F5 验证：analyze.py 真的并发下载（而不是顺序下载），且 NDJSON 正常。
// 用假的 music2emo 包替掉模型，只跑下载 → 解码 → “推理”调用链。
const venvPython = 'E:\\Software\\audioml-m2e\\Scripts\\python.exe'
const hasVenv = fs.existsSync(venvPython)
const analyzePy = fileURLToPath(new URL('../tools/m2e/analyze.py', import.meta.url))

function runProcess(command, args, { input, env, timeout = 180000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* ignore */ }
    }, timeout)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: String(error) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
    if (input) child.stdin.end(input)
    else child.stdin.end()
  })
}

function makeWav() {
  const sampleRate = 24000
  const samples = sampleRate * 4
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

test('F5：下载并发执行，NDJSON 仍按顺序逐首输出', { skip: hasVenv ? false : '本机没有 music2emo venv' }, async () => {
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'bgm-concurrency-'))
  const codeDir = path.join(work, 'code')
  const modelsDir = path.join(work, 'models')
  const cacheDir = path.join(work, 'cache')
  const pkgDir = path.join(codeDir, 'music2emo')
  await fsp.mkdir(pkgDir, { recursive: true })
  await fsp.mkdir(path.join(codeDir, 'inference', 'data'), { recursive: true })
  await fsp.mkdir(modelsDir, { recursive: true })

  await fsp.writeFile(path.join(pkgDir, '__init__.py'), [
    'import time',
    '',
    'class Music2emo:',
    '    def __init__(self, model_weights=None, **kwargs):',
    '        pass',
    '',
    '    def predict(self, audio):',
    '        time.sleep(0.2)',
    '        return {"probs": [0.1] * 56, "valence": 1.0, "arousal": 2.0}'
  ].join('\n'), 'utf8')

  const setupPy = path.join(work, 'setup_tags.py')
  await fsp.writeFile(setupPy, [
    'import numpy as np, os, sys',
    'target = sys.argv[1]',
    'os.makedirs(os.path.dirname(target), exist_ok=True)',
    'np.save(target, np.array(["mood/theme---tag%d" % i for i in range(183)]))'
  ].join('\n'), 'utf8')
  const tagPath = path.join(codeDir, 'inference', 'data', 'tag_list.npy')
  const setup = await runProcess(venvPython, [setupPy, tagPath], { timeout: 60000 })
  assert.equal(setup.code, 0, setup.stderr)

  const wav = makeWav()
  let active = 0
  let maxActive = 0
  let requests = 0
  const server = http.createServer((req, res) => {
    requests += 1
    active += 1
    maxActive = Math.max(maxActive, active)
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': String(wav.length) })
      res.end(wav)
      active -= 1
    }, 300)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  const job = {
    tracks: [1, 2, 3, 4].map((i) => ({
      song_id: 9900 + i,
      title: `t${i}`,
      url: `http://127.0.0.1:${port}/${i}.wav`
    })),
    models: modelsDir,
    code: codeDir,
    cache: { dir: cacheDir, version: 'test-v1', max_bytes: 0, concurrency: 2 }
  }

  const started = Date.now()
  const result = await runProcess(venvPython, [analyzePy], {
    input: JSON.stringify(job),
    env: { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost', PYTHONIOENCODING: 'utf-8' }
  })
  server.close()
  const elapsed = Date.now() - started

  assert.equal(result.code, 0, `python 退出码 ${result.code}：${result.stderr.slice(-500)}`)
  assert.ok(maxActive >= 2, `应至少有两个下载重叠，实际 maxActive=${maxActive}`)
  assert.equal(requests, 4)

  const lines = result.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  const results = lines.filter((line) => line.song_id !== undefined)
  const done = lines.find((line) => line.done === true)
  assert.equal(results.length, 4)
  assert.deepEqual(results.map((line) => line.song_id), [9901, 9902, 9903, 9904], 'NDJSON 顺序应与输入一致')
  for (const line of results) assert.equal(Object.keys(line.result.probs).length, 56)
  assert.equal(done.count, 4)

  const cached = (await fsp.readdir(cacheDir)).filter((name) => name.endsWith('.wav'))
  assert.equal(cached.length, 4, '四首都应落进音频缓存')

  // 4 首 × 0.2s 推理 + 并发下载；顺序下载至少要 4 × 0.3s，这里只确认没慢得离谱
  assert.ok(elapsed < 60000, `耗时异常：${elapsed}ms`)
})

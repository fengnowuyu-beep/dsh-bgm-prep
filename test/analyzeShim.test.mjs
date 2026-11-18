import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// 上游 music2emo 的 chord_root.json 缺 X；analyze.py 的运行期垫片只在内存里补。
// 这里验证：补在正确的文件上、不写盘、已有 X 不覆盖、其他 json 不受影响。
const venvPython = 'E:\\Software\\audioml-m2e\\Scripts\\python.exe'
const hasVenv = fs.existsSync(venvPython)
const analyzePy = fileURLToPath(new URL('../tools/m2e/analyze.py', import.meta.url))

function runProcess(command, args, { timeout = 60000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args)
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => { try { child.kill() } catch { /* ignore */ } }, timeout)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(error) }) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }) })
    child.stdin.end()
  })
}

test('垫片：只给 chord_root.json 补 X，不写盘、不碰其他 json', { skip: hasVenv ? false : '本机没有 music2emo venv' }, async () => {
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'bgm-shim-'))
  const chordRoot = path.join(work, 'inference', 'data', 'chord_root.json')
  await fsp.mkdir(path.dirname(chordRoot), { recursive: true })
  await fsp.writeFile(chordRoot, JSON.stringify({ N: 0, C: 1, 'C#': 2 }), 'utf8')

  const driverPath = path.join(work, 'driver.py')
  await fsp.writeFile(driverPath, [
    'import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("m2e_analyze", sys.argv[1])',
    'mod = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(mod)',
    'with open(sys.argv[2], "r", encoding="utf-8") as fp:',
    '    patched = mod._JsonWithUnknownChordRoot().load(fp)',
    'other = mod._inject_unknown_chord_root({"N": 0, "C": 1}, "inference/data/chord_attr.json")',
    'existing = mod._inject_unknown_chord_root({"N": 0, "X": 7}, "chord_root.json")',
    'print(json.dumps({"patched": patched, "other": other, "existing": existing}))'
  ].join('\n'), 'utf8')

  const result = await runProcess(venvPython, [driverPath, analyzePy, chordRoot])
  assert.equal(result.code, 0, `python 退出码 ${result.code}：${result.stderr.slice(-400)}`)
  const parsed = JSON.parse(result.stdout.trim().split('\n').pop())

  assert.equal(parsed.patched.X, 0, 'X 应补成 N 的 ID 0')
  assert.equal(parsed.patched.C, 1)
  assert.equal(parsed.other.X, undefined, 'chord_attr.json 不应被补')
  assert.equal(parsed.existing.X, 7, '已有 X 不应被覆盖')

  const onDisk = JSON.parse(await fsp.readFile(chordRoot, 'utf8'))
  assert.equal(onDisk.X, undefined, '磁盘上的 chord_root.json 不能被修改')
})

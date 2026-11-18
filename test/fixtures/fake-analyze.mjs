// 测试替身：模拟 tools/m2e/analyze.py 的 NDJSON 输出。
// 通过 FAKE_MODE / FAKE_LOG 控制行为，不依赖真实 Python 环境。
import fsp from 'node:fs/promises'

const mode = process.env.FAKE_MODE || 'ok'
const logFile = process.env.FAKE_LOG || ''

let input = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) input += chunk

const job = JSON.parse(input || '{}')
const tracks = Array.isArray(job.tracks) ? job.tracks : []

if (logFile) {
  await fsp.appendFile(logFile, `${JSON.stringify({
    mode,
    jobMode: job.mode ?? 'full',
    count: tracks.length,
    ids: tracks.map((t) => t.song_id),
    cache: job.cache ?? null,
    threads: process.env.M2E_THREADS ?? null
  })}\n`, 'utf8')
}

const emit = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function resultFor(songId) {
  return {
    song_id: songId,
    result: {
      probs: { dark: 0.5, calm: 0.25, dramatic: 0.25 },
      va: { valence: 3.0, arousal: 5.0 },
      stability: null,
      // 开了人声识别时给一个固定概率，方便断言写回
      vocal: job.vocal?.enabled === false ? null : 0.7
    }
  }
}

if (job.mode === 'vocal') {
  for (const track of tracks) emit({ song_id: track.song_id, vocal: 0.7 })
  emit({ done: true, count: tracks.length })
} else if (mode === 'legacy') {
  const results = {}
  for (const track of tracks) results[String(track.song_id)] = resultFor(track.song_id).result
  process.stdout.write(`${JSON.stringify({ results })}\n`)
} else if (mode === 'fatal') {
  process.stdout.write(`${JSON.stringify({ error: 'fake model load failure' })}\n`)
} else if (mode === 'crash') {
  if (tracks[0]) emit(resultFor(tracks[0].song_id))
  process.exit(3)
} else {
  for (let index = 0; index < tracks.length; index += 1) {
    if (mode === 'budget') {
      if (index === 0) emit(resultFor(tracks[index].song_id))
      await sleep(60000)
      continue
    }
    if (mode === 'timeout' && index === 1 && tracks.length > 1) {
      await sleep(60000)
      continue
    }
    emit(resultFor(tracks[index].song_id))
  }
  emit({ done: true, count: tracks.length })
}

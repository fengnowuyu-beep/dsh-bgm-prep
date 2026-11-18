import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { openUpstream, passthroughHeaders, pipeUpstream } from '../lib/audioProxy.js'

const BODY = Buffer.alloc(4096, 7)

/** 起一个假 CDN：支持完整 GET、Range、以及 302 跳转。 */
async function startFakeCdn() {
  const server = http.createServer((req, res) => {
    const range = req.headers.range
    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/full' })
      res.end()
      return
    }
    if (req.url === '/gone') {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('nope')
      return
    }
    if (req.url === '/ranged' || req.url === '/full') {
      if (typeof range === 'string' && /^bytes=\d+-\d*$/.test(range)) {
        const [startRaw, endRaw] = range.replace('bytes=', '').split('-')
        const start = Number(startRaw)
        const end = endRaw === '' ? BODY.length - 1 : Math.min(Number(endRaw), BODY.length - 1)
        const slice = BODY.subarray(start, end + 1)
        res.writeHead(206, {
          'content-type': 'audio/flac',
          'content-length': String(slice.length),
          'content-range': `bytes ${start}-${end}/${BODY.length}`,
          'accept-ranges': 'bytes'
        })
        res.end(slice)
        return
      }
      res.writeHead(200, { 'content-type': 'audio/flac', 'content-length': String(BODY.length) })
      res.end(BODY)
      return
    }
    res.writeHead(400).end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return { server, base: `http://127.0.0.1:${port}` }
}

function collect(stream) {
  return new Promise((resolve, reject) => {
    const chunks = []
    stream.on('data', (c) => chunks.push(c))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}

test('完整取流：200、原样字节、content-type 透传', async (t) => {
  const cdn = await startFakeCdn()
  t.after(() => cdn.server.close())
  const upstream = await openUpstream(`${cdn.base}/full`)
  assert.equal(upstream.status, 200)
  const bytes = await collect(upstream.stream)
  assert.equal(bytes.length, BODY.length)
  assert.equal(upstream.headers['content-type'], 'audio/flac')
})

test('Range 透传：206 + content-range + 只回请求的那一段', async (t) => {
  const cdn = await startFakeCdn()
  t.after(() => cdn.server.close())
  const upstream = await openUpstream(`${cdn.base}/ranged`, { range: 'bytes=100-199' })
  assert.equal(upstream.status, 206)
  assert.equal(upstream.headers['content-range'], `bytes 100-199/${BODY.length}`)
  const bytes = await collect(upstream.stream)
  assert.equal(bytes.length, 100)
  assert.deepEqual(bytes, BODY.subarray(100, 200))
})

test('302 会跟到最终地址，且把 Range 带过去', async (t) => {
  const cdn = await startFakeCdn()
  t.after(() => cdn.server.close())
  const upstream = await openUpstream(`${cdn.base}/redirect`, { range: 'bytes=0-9' })
  assert.equal(upstream.status, 206)
  assert.equal((await collect(upstream.stream)).length, 10)
})

test('上游 404 原样交给调用方，不抛异常', async (t) => {
  const cdn = await startFakeCdn()
  t.after(() => cdn.server.close())
  const upstream = await openUpstream(`${cdn.base}/gone`)
  assert.equal(upstream.status, 404)
  upstream.stream.resume()
})

test('非法 URL 直接 reject', async () => {
  await assert.rejects(() => openUpstream('not a url'), /不是合法 URL/)
  await assert.rejects(() => openUpstream('ftp://example.com/a.flac'), /不支持的直链协议/)
})

test('passthroughHeaders 只放行音频相关头', () => {
  const out = passthroughHeaders({
    'content-type': 'audio/flac',
    'content-range': 'bytes 0-1/10',
    'set-cookie': 'a=b',
    'x-internal': 'nope'
  })
  assert.equal(out['content-type'], 'audio/flac')
  assert.equal(out['content-range'], 'bytes 0-1/10')
  assert.equal(out['accept-ranges'], 'bytes')
  assert.equal(out['cache-control'], 'no-store')
  assert.equal(out['set-cookie'], undefined)
  assert.equal(out['x-internal'], undefined)
})

test('content-type 是 octet-stream / 缺失时按 level 兜底', () => {
  assert.equal(
    passthroughHeaders({ 'content-type': 'application/octet-stream;charset=UTF-8' }, { level: 'lossless' })['content-type'],
    'audio/flac'
  )
  assert.equal(
    passthroughHeaders({}, { level: 'exhigh' })['content-type'],
    'audio/mpeg'
  )
  // 上游给了正经 audio/* 就不要覆盖
  assert.equal(
    passthroughHeaders({ 'content-type': 'audio/mp4' }, { level: 'lossless' })['content-type'],
    'audio/mp4'
  )
})

test('pipeUpstream 把字节写到 response 上', async (t) => {
  const cdn = await startFakeCdn()
  t.after(() => cdn.server.close())
  const upstream = await openUpstream(`${cdn.base}/full`)
  const fakeResponse = new (await import('node:stream')).PassThrough()
  pipeUpstream(upstream, fakeResponse)
  const bytes = await collect(fakeResponse)
  assert.equal(bytes.length, BODY.length)
})

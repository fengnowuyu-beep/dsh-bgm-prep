import http from 'node:http'
import { Workbench } from '../lib/ui.js'

const wb = new Workbench({ getTools: () => ({}), logger: console })
const server = http.createServer((req, res) => { void wb.handle(req, res) })
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port

const withRange = await fetch(`http://127.0.0.1:${port}/bgm-prep/api/audio?id=1935704983`, { headers: { range: 'bytes=1000-2000' } })
console.log('带 Range:', withRange.status,
  '| content-range:', withRange.headers.get('content-range'),
  '| accept-ranges:', withRange.headers.get('accept-ranges'),
  '| length:', withRange.headers.get('content-length'))
await withRange.body?.cancel?.()

const plain = await fetch(`http://127.0.0.1:${port}/bgm-prep/api/audio?id=1935704983`)
console.log('不带 Range:', plain.status, '| accept-ranges:', plain.headers.get('accept-ranges'))
await plain.body?.cancel?.()

server.close()

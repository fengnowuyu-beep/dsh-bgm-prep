import http from 'node:http'
import { Workbench } from '../lib/ui.js'

const wb = new Workbench({ getTools: () => ({}), logger: console })
const server = http.createServer((req, res) => { void wb.handle(req, res) })
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port

const res = await fetch(`http://127.0.0.1:${port}/bgm-prep/api/audio?id=1935704983`, { redirect: 'manual' })
console.log('状态:', res.status)
console.log('Location:', String(res.headers.get('location')).slice(0, 90))
server.close()

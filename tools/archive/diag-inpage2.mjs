const version = await (await fetch('http://127.0.0.1:9333/json/version')).json()
const ws = new WebSocket(version.webSocketDebuggerUrl)
const send = (payload) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve({ timeout: true }), 20000)
  const onMsg = (e) => {
    const m = JSON.parse(e.data)
    if (m.id === payload.id) { clearTimeout(timer); ws.removeEventListener('message', onMsg); resolve(m) }
  }
  ws.addEventListener('message', onMsg)
  ws.send(JSON.stringify(payload))
})
await new Promise((r) => { ws.onopen = r })

const targets = await send({ id: 1, method: 'Target.getTargets' })
const page = (targets.result?.targetInfos ?? []).find(t => t.type === 'page' && String(t.url).includes('music.163.com'))
if (!page) { console.log('没有 music.163.com 页面'); ws.close(); process.exit(0) }
console.log('目标:', page.url)

const attached = await send({ id: 2, method: 'Target.attachToTarget', params: { targetId: page.targetId, flatten: true } })
const sessionId = attached.result?.sessionId
const expr = `(async () => {
  const r = await fetch('https://music.163.com/api/song/enhance/player/url?id=466233199&ids=%5B466233199%5D&br=320000', { credentials: 'include' })
  const j = await r.json()
  const url = j?.data?.[0]?.url
  if (!url) return { api: r.status, hasUrl: false }
  const a = await fetch(url, { credentials: 'omit' })
  return { api: r.status, hasUrl: true, cdn: a.status, type: a.headers.get('content-type') }
})()`
const res = await send({ id: 3, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true }, sessionId })
console.log('页面内结果:', JSON.stringify(res.result?.result?.value ?? res).slice(0, 300))
ws.close()

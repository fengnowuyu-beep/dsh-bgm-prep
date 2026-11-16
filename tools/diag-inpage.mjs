const list = await (await fetch('http://127.0.0.1:9333/json/list')).json()
const page = list.find(t => t.type === 'page' && String(t.url).includes('music.163.com'))
if (!page) { console.log('没找到 music.163.com 的页面'); process.exit(0) }
console.log('页面:', page.url)
const ws = new WebSocket(page.webSocketDebuggerUrl)
const expr = `(async () => {
  const r = await fetch('https://music.163.com/api/song/enhance/player/url?id=466233199&ids=%5B466233199%5D&br=320000', { credentials: 'include' })
  const j = await r.json()
  const url = j?.data?.[0]?.url
  if (!url) return { api: r.status, url: false }
  const a = await fetch(url)
  return { api: r.status, url: true, cdn: a.status, type: a.headers.get('content-type') }
})()`
const reply = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve({ timeout: true }), 25000)
  ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }))
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === 1) { clearTimeout(timer); resolve(m) } }
  ws.onerror = () => { clearTimeout(timer); resolve({ error: 'ws' }) }
})
ws.close()
console.log('页面内结果:', JSON.stringify(reply.result?.result?.value ?? reply).slice(0, 300))

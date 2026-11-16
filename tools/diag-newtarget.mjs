const v = await (await fetch('http://127.0.0.1:9333/json/version')).json()
const ws = new WebSocket(v.webSocketDebuggerUrl)
const reply = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve({ timeout: true }), 10000)
  ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url: 'https://music.163.com/#/login' } }))
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === 1) { clearTimeout(timer); resolve(m) } }
  ws.onerror = () => { clearTimeout(timer); resolve({ error: 'ws' }) }
})
ws.close()
console.log('createTarget:', JSON.stringify(reply).slice(0, 300))

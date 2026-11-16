const ENDPOINTS = ['http://127.0.0.1:9333', 'http://127.0.0.1:9222']
let version = null
let used = ''
for (const ep of ENDPOINTS) {
  try {
    const r = await fetch(`${ep}/json/version`, { signal: AbortSignal.timeout(4000) })
    if (r.ok) { version = await r.json(); used = ep; break }
  } catch { /* 下一个 */ }
}
if (!version) { console.log('CDP 无响应'); process.exit(0) }
console.log('CDP:', used, '|', version.Browser)

const ws = new WebSocket(version.webSocketDebuggerUrl)
const result = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve({ timeout: true }), 15000)
  ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Storage.getCookies', params: {} }))
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id === 1) { clearTimeout(timer); resolve(msg.result ?? { error: msg.error }) }
  }
  ws.onerror = (e) => { clearTimeout(timer); resolve({ error: String(e?.message ?? 'ws error') }) }
})
ws.close()
const cookies = result.cookies ?? []
console.log('cookies 总数:', cookies.length)
const music163 = cookies.filter(c => String(c.domain).includes('music.163.com'))
console.log('music.163.com 的 cookie:', music163.map(c => c.name).join(', ') || '(无)')
const target = music163.find(c => c.name === 'MUSIC_U')
console.log('MUSIC_U:', target ? `长度 ${String(target.value).length}，过期 ${new Date(target.expires * 1000).toISOString()}` : '没找到')

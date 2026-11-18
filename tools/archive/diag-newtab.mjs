const res = await fetch('http://127.0.0.1:9333/json/new?' + encodeURIComponent('https://music.163.com/#/login'), { method: 'PUT', signal: AbortSignal.timeout(8000) })
const text = await res.text()
console.log('/json/new (PUT):', res.status, text.slice(0, 200))

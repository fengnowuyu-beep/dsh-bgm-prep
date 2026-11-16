try {
  const res = await fetch('http://127.0.0.1:9333/json/new?' + encodeURIComponent('https://music.163.com/'), { method: 'GET', signal: AbortSignal.timeout(8000) })
  console.log('/json/new (GET):', res.status, (await res.text()).slice(0, 160))
} catch (e) { console.log('GET 失败:', e.message) }

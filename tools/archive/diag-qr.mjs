const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const h = { 'user-agent': UA, referer: 'https://music.163.com/', origin: 'https://music.163.com' }

// 1) 取二维码 unikey
const u = await fetch('https://music.163.com/api/login/qrcode/unikey?type=1', {
  method: 'POST', headers: { ...h, 'content-type': 'application/x-www-form-urlencoded' }, body: 'type=1', signal: AbortSignal.timeout(15000)
})
const uj = await u.json().catch(() => null)
console.log('unikey:', u.status, JSON.stringify(uj))

if (uj?.unikey) {
  // 2) 轮询一次，看状态码语义
  const p = await fetch(`https://music.163.com/api/login/qrcode/client/login?key=${uj.unikey}&type=1`, {
    method: 'POST', headers: { ...h, 'content-type': 'application/x-www-form-urlencoded' }, body: '', signal: AbortSignal.timeout(15000)
  })
  const pj = await p.json().catch(() => null)
  console.log('poll:', p.status, 'code=', pj?.code, 'message=', pj?.message ?? '')
}

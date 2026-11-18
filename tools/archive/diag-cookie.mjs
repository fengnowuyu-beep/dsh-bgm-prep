import { readCookie } from '../lib/tag.js'
const cookie = await readCookie()
const base = { 'user-agent': 'Mozilla/5.0', referer: 'https://music.163.com/' }
const withCookie = { ...base, cookie: `MUSIC_U=${cookie}` }

// 1) cookie 还有效吗：查当前登录用户
const acct = await fetch('https://music.163.com/api/nuser/account/get', { headers: withCookie })
const acctJson = await acct.json().catch(() => ({}))
console.log('账号接口:', acct.status, '| code:', acctJson?.code, '| 昵称:', acctJson?.profile?.nickname ?? '(无)')

// 2) outer/url 带 cookie
const outer = await fetch('https://music.163.com/song/media/outer/url?id=21527159.mp3', { headers: withCookie, redirect: 'manual' })
console.log('outer/url:', outer.status, '| type:', outer.headers.get('content-type'), '| location:', (outer.headers.get('location') ?? '').slice(0, 60))

// 3) enhance 接口带 cookie
const enh = await fetch('https://music.163.com/api/song/enhance/player/url?id=21527159&ids=%5B21527159%5D&br=320000', { headers: withCookie })
const ej = await enh.json().catch(() => null)
const item = ej?.data?.[0]
console.log('enhance:', enh.status, '| code:', ej?.code, '| url:', item?.url ? '有' : '无', '| fee:', item?.fee, '| 试听:', item?.freeTrialInfo ? '是' : '否')

#!/usr/bin/env node
// 一次性配置脚本：写凭据 / 扫码登录 / 自检。
//
//   node scripts/setup.mjs --app-id <id> --private-key <key>   # 写入凭据
//   node scripts/setup.mjs --login                            # 出二维码并等待扫码
//   node scripts/setup.mjs --check                            # 自检当前状态

import fs from 'node:fs'
import process from 'node:process'
import * as ncm from '../lib/ncm.js'

function arg(name) {
  const i = process.argv.indexOf(name)
  return i === -1 ? null : process.argv[i + 1]
}

const appId = arg('--app-id')
const privateKey = arg('--private-key')

if (appId && privateKey) {
  await ncm.writeCredentials({ appId, privateKey })
  console.log(`✅ 凭据已写入 ${ncm.credentialsPath()}`)
  console.log('   下一步：node scripts/setup.mjs --login')
  process.exit(0)
}

if (process.argv.includes('--cli-login')) {
  // 数据类操作（搜歌 / 读歌单 / 建歌单）走 ncm-cli，它需要自己的一份登录态
  const d = await ncm.cli(['login'])
  const url = d?.clickableUrl ?? d?.qrCodeUrl ?? ''
  console.log('')
  console.log(url ? `  用网易云 App 打开这个链接完成登录：\n\n  ${url}\n` : JSON.stringify(d))
  console.log('  扫完后再跑一次 --check，确认「CLI 登录」是 ✅')
  process.exit(0)
}

if (process.argv.includes('--check')) {
  const creds = ncm.readCredentials()
  console.log('凭据:', creds ? `已配置 appId=${creds.appId}` : '❌ 未配置')
  const token = ncm.readToken()
  if (!token) console.log('登录: ❌ 无 token')
  else console.log(`登录: ${token.anonymous ? '仅匿名' : '✅ 用户已登录'}  accessToken=${String(token.accessToken).slice(0, 12)}…`)
  console.log('CLI 登录:', (await ncm.cliLoggedIn()) ? '✅ ncm-cli 已登录' : '❌ ncm-cli 未登录（跑 --cli-login）')

  if (!creds) process.exit(1)
  try {
    const anon = await ncm.anonymousToken()
    console.log('匿名 token: ✅', String(anon.accessToken).slice(0, 12) + '…')
  } catch (error) {
    console.log('匿名 token: ❌', error.message)
  }
  if (ncm.hasUserToken()) {
    try {
      const me = await ncm.profile()
      console.log('用户资料: ✅', JSON.stringify(me).slice(0, 200))
    } catch (error) {
      console.log('用户资料: ❌', error.message)
    }
  }
  process.exit(0)
}

if (process.argv.includes('--login')) {
  if (!ncm.readCredentials()) {
    console.error('❌ 先配置凭据：node scripts/setup.mjs --app-id <id> --private-key <key>')
    process.exit(1)
  }
  const { key, url } = await ncm.createQrCode()
  console.log('')
  console.log('  用网易云 App 扫码 / 直接点开这个链接：')
  console.log('')
  console.log('  ' + url)
  console.log('')
  console.log('  二维码有效期约 5 分钟，等待中……')
  console.log('')

  const deadline = Date.now() + 290_000
  let last = ''
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000))
    let data
    try {
      data = await ncm.pollQrCode(key)
    } catch (error) {
      last = error.message
      continue
    }
    const status = String(data?.status ?? data?.code ?? '')
    if (status !== last) {
      console.log(`  状态: ${status || '(空)'} ${status === '801' ? '等待扫码' : status === '802' ? '已扫码，等待确认' : ''}`)
      last = status
    }
    if (status === '803') {
      const t = ncm.normalizeTokenPayload(data)
      if (!t.accessToken) {
        console.error('803 但没有拿到 accessToken，原始返回：', JSON.stringify(data).slice(0, 400))
        process.exit(1)
      }
      await ncm.atomicWrite(ncm.tokenPath(), JSON.stringify({
        accessToken: t.accessToken,
        refreshToken: t.refreshToken,
        anonymous: false,
        expireAt: Date.now() + t.expireTime * 1000,
        savedAt: new Date().toISOString()
      }, null, 2))
      console.log('')
      console.log('✅ 登录成功，token 已保存到 ' + ncm.tokenPath())
      try {
        const me = await ncm.profile()
        console.log('   账号:', JSON.stringify(me).slice(0, 200))
      } catch (error) {
        console.log('   读取资料失败（可忽略）:', error.message)
      }
      process.exit(0)
    }
    if (status === '800') {
      console.log('  二维码已过期，请重新运行本命令。')
      process.exit(2)
    }
  }
  console.log('  等待超时。重新运行本命令生成新二维码。')
  process.exit(3)
}

console.log(`用法：
  node scripts/setup.mjs --app-id <id> --private-key <key>
  node scripts/setup.mjs --login
  node scripts/setup.mjs --check`)

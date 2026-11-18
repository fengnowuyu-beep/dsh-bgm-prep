// 音频转发：宿主直连 CDN，再把字节转给浏览器。
//
// 为什么不再 302：浏览器拉 CDN 会走系统代理。代理开着、进程却没起来时
// （实测 2026-11-18：ProxyServer=127.0.0.1:7897，端口无监听），<audio> 直接
// onError，界面只弹一句「这首放不了」，看不出原因。宿主（Node）不读系统代理，
// 由它取流再转发，播放就与浏览器的代理设置无关；顺带统一 UA/Referer。
//
// 只做三件事：打开上游、跟随重定向、把响应头挑成浏览器要的样子。
// 断流/超时/取消都由调用方负责销毁。

import http from 'node:http'
import https from 'node:https'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const MAX_REDIRECTS = 3

/**
 * 打开上游音频流。
 * @param {string} url 直链
 * @param {{range?: string, timeoutMs?: number, redirects?: number}} options
 * @returns {Promise<{status:number, headers:object, stream:import('node:stream').Readable, url:string}>}
 */
export function openUpstream(url, { range = '', timeoutMs = 15000, redirects = MAX_REDIRECTS } = {}) {
  return new Promise((resolve, reject) => {
    let target
    try {
      target = new URL(url)
    } catch (error) {
      reject(new Error(`直链不是合法 URL：${String(url).slice(0, 80)}`))
      return
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      reject(new Error(`不支持的直链协议：${target.protocol}`))
      return
    }
    const lib = target.protocol === 'https:' ? https : http
    const headers = { 'user-agent': UA, referer: 'https://music.163.com/' }
    if (typeof range === 'string' && range !== '') headers.range = range

    const req = lib.request(target, { method: 'GET', headers }, (upstream) => {
      const status = Number(upstream.statusCode ?? 0)
      const location = upstream.headers?.location
      if ([301, 302, 303, 307, 308].includes(status) && typeof location === 'string' && redirects > 0) {
        upstream.resume() // 丢掉重定向响应体，别占着连接
        const next = new URL(location, target).toString()
        openUpstream(next, { range, timeoutMs, redirects: redirects - 1 }).then(resolve, reject)
        return
      }
      resolve({ status, headers: upstream.headers ?? {}, stream: upstream, url: target.toString() })
    })

    req.setTimeout(timeoutMs, () => req.destroy(new Error(`上游超时（${timeoutMs}ms）`)))
    req.on('error', reject)
    req.end()
  })
}

/**
 * 挑出与音频播放相关的上游响应头；range 请求必须带 content-range，否则拖动进度条会失效。
 * @param {object} upstreamHeaders
 * @param {{level?: string}} options level 来自网易的直链信息，用来兜底 content-type
 */
export function passthroughHeaders(upstreamHeaders = {}, { level = '' } = {}) {
  const out = { 'cache-control': 'no-store', 'accept-ranges': 'bytes' }
  for (const name of ['content-type', 'content-length', 'content-range', 'etag', 'last-modified']) {
    const value = upstreamHeaders[name]
    if (typeof value === 'string' && value !== '') out[name] = value
  }
  // 有些 CDN（实测 m704 的无损 flac）把 content-type 报成 application/octet-stream。
  // 浏览器多半能靠嗅探播，但别赌：按直链等级补一个明确类型。
  if (!/^(audio|video)\//i.test(String(out['content-type'] ?? ''))) {
    out['content-type'] = level === 'lossless' ? 'audio/flac' : 'audio/mpeg'
  }
  return out
}

/** 把上游响应当成浏览器响应流出去；出错就掐断，避免半截音频卡在播放器里。 */
export function pipeUpstream(upstream, response) {
  const { stream } = upstream
  stream.on('error', () => {
    try { response.destroy() } catch { /* 已断开 */ }
  })
  response.on('close', () => {
    try { stream.destroy() } catch { /* 已结束 */ }
  })
  stream.pipe(response)
}

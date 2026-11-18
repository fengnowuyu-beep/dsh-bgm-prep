// 只读探针：预加载后拦截 ncm-cli 发出的 HTTP 请求，把 URL 与请求体落盘。
// 用于观察它的真实参数结构（尤其 device 与 sign），不修改任何请求内容。
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const https = require('node:https')

const LOG = process.env.NCM_SPY_LOG || path.join(os.homedir(), '.dsh', 'bgm-prep', 'spy.log')

function record(entry) {
  try {
    fs.appendFileSync(LOG, JSON.stringify(entry) + '\n')
  } catch { /* ignore */ }
}

function hook(mod, scheme) {
  const orig = mod.request
  mod.request = function (...args) {
    const chunks = []
    const req = orig.apply(this, args)
    const write = req.write.bind(req)
    const end = req.end.bind(req)
    req.write = (chunk, ...rest) => {
      if (chunk) chunks.push(Buffer.from(chunk))
      return write(chunk, ...rest)
    }
    req.end = (chunk, ...rest) => {
      if (chunk) chunks.push(Buffer.from(chunk))
      const opt = args[0]
      record({
        scheme,
        host: (opt && (opt.hostname || opt.host)) || null,
        path: (opt && opt.path) || null,
        href: typeof opt === 'string' ? opt : (opt && opt.href) || null,
        headers: (opt && opt.headers) || {},
        body: Buffer.concat(chunks).toString('utf8')
      })
      return end(chunk, ...rest)
    }
    return req
  }
}

hook(http, 'http')
hook(https, 'https')

const origFetch = globalThis.fetch
if (typeof origFetch === 'function') {
  globalThis.fetch = async (input, init) => {
    let href = ''
    let body = ''
    const info = { hasInput: input !== undefined, inputType: typeof input }
    try {
      info.ctor = input && input.constructor ? input.constructor.name : null
      if (typeof input === 'string') href = input
      else if (input && typeof input.url === 'string') href = input.url
      else if (input && typeof input.href === 'string') href = input.href
      else href = String(input)
    } catch (err) {
      info.inputError = String(err)
    }
    try {
      if (init && typeof init.body === 'string') body = init.body
      else if (init && init.body) body = `[${init.body.constructor && init.body.constructor.name}]`
      else if (input && typeof input.clone === 'function') {
        const text = await input.clone().text()
        body = String(text).slice(0, 8000)
      }
    } catch (err) {
      info.bodyError = String(err)
    }
    record({ scheme: 'fetch', href, body, ...info })
    return origFetch(input, init)
  }
}

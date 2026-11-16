import { apply } from '../lib/index.js'
const tools = new Map()
apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: {} })
const exec = { agent: { session: { header: { cwd: process.cwd() } } } }
const file = 'F:/Data/听枫馆/模组/COC/080天体之音/bgm/tianti.cues.json'
const preview = await tools.get('bgm_commit').execute({ file, dry_run: true }, exec)
console.log('预览:', JSON.stringify({ playlist: preview.playlist, added: preview.added, total: preview.total }))
const r = await tools.get('bgm_commit').execute({ file }, exec)
console.log('结果:', JSON.stringify({ ok: r.ok, playlist: r.playlist, playlistId: r.playlistId, added: r.added, total: r.total, error: r.error }))

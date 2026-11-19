// 测试用假 ncm-cli：按参数返回固定的 JSON，避免测试依赖网络与真实登录。
// 用法：process.env.NCM_CLI 指向本文件。

const argv = process.argv.slice(2)

const TRACKS = [
  { originalId: 11, id: 'A'.repeat(32), name: 'The Cellar', duration: 240000, artists: [{ name: 'A' }], album: { name: 'OST' } },
  { originalId: 12, id: 'B'.repeat(32), name: 'The Cellar (Live)', duration: 240000, artists: [{ name: 'A' }], album: { name: 'Live' } },
  { originalId: 13, id: 'C'.repeat(32), name: 'Dread Drone', duration: 300000, artists: [{ name: 'B' }], album: { name: 'Ambient' } },
  { originalId: 14, id: 'D'.repeat(32), name: 'Deep Halls', duration: 180000, artists: [{ name: 'C' }], album: { name: 'Vol.2' } },
  { originalId: 15, id: 'E'.repeat(32), name: '封面 翻唱', duration: 200000, artists: [{ name: 'D' }], album: { name: 'x' } },
  { originalId: 16, id: 'F'.repeat(32), name: '静默前奏', duration: 60, artists: [{ name: 'E' }], album: { name: 'y' } },
  { originalId: 17, id: 'G'.repeat(32), name: 'Sold Out', duration: 200000, artists: [{ name: 'F' }], album: { name: 'z' }, playFlag: false, noCopyrightRcmd: { type: 1, typeName: '无版权' } },
  { originalId: 18, id: 'H'.repeat(32), name: '只能试听', duration: 200000, artists: [{ name: 'G' }], album: { name: 'w' }, freeTrialPrivilege: { cannotListenReason: 1 } },
  { originalId: 19, id: 'I'.repeat(32), name: '播放权限为负', duration: 200000, artists: [{ name: 'H' }], album: { name: 'v' }, privilege: { st: -200 } },
  { originalId: 20, id: '0123456789abcdef0123456789abcdef', name: '歌单里的常规曲目', duration: 200000, artists: [{ name: 'I' }], album: { name: 'u' }, playFlag: false }
]

const NOT_LOGGED = () => {
  process.stderr.write('未登录，请执行 ncm-cli login 完成登录\n')
  process.exit(1)
}

function out(data) {
  process.stdout.write(JSON.stringify({ code: 200, data }) + '\n')
  process.exit(0)
}

const has = (s) => argv.includes(s)
const val = (flag) => {
  const i = argv.indexOf(flag)
  return i === -1 ? undefined : argv[i + 1]
}

if (has('login') && has('--check')) out({ success: true, message: '已登录实名账号' })

if (argv[0] === 'search' && argv[1] === 'song') {
  const kw = val('--keyword') ?? ''
  const limit = Number(val('--limit') ?? 30)
  out({ recordCount: TRACKS.length, records: TRACKS.slice(0, limit).map((t) => ({ ...t, alg: kw })) })
}

if (argv[0] === 'search' && argv[1] === 'playlist') {
  out({ recordCount: 2, records: [
    { id: '1'.repeat(32), originalId: 1001, name: '跑团 BGM · 压抑', trackCount: 20 },
    { id: '2'.repeat(32), originalId: 1002, name: '地城探索 纯音乐', trackCount: 30 }
  ] })
}

if (argv[0] === 'playlist' && argv[1] === 'tracks') {
  out({ recordCount: TRACKS.length, records: TRACKS })
}

if (argv[0] === 'playlist' && argv[1] === 'created') {
  out({ recordCount: 1, records: [{ id: '3'.repeat(32), originalId: 2001, name: '我的跑团歌单', trackCount: 12 }] })
}

if (argv[0] === 'playlist' && argv[1] === 'create') {
  out({ id: '9'.repeat(32), name: val('--playlistName') ?? '' })
}

if (argv[0] === 'playlist' && argv[1] === 'add') {
  out({ added: (val('--songIdList') ?? '[]').length })
}

if (argv[0] === 'playlist' && argv[1] === 'remove') out({ removed: 0 })

process.stderr.write(`fake-cli: 未实现 ${argv.join(' ')}\n`)
process.exit(2)

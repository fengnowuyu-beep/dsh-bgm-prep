import * as ncm from '../lib/ncm.js'
const file = 'F:/Data/听枫馆/模组/COC/018通向庭院之歌/bgm/tongxiang.cues.json'
await ncm.atomicWrite(ncm.dataDir() + '/ui-state.json', JSON.stringify({
  active: file,
  recent: [{ file, at: new Date().toISOString() }]
}, null, 2))
console.log('state 写入:', ncm.dataDir() + '/ui-state.json')

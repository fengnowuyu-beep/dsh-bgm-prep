import { apply } from '../lib/index.js'
import { Workbench } from '../lib/ui.js'
const tools = new Map()
apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: { info() {}, warn() {} } })
const wb = new Workbench({ getTools: () => tools, logger: {} })
const s = await wb.snapshot('F:/Data/听枫馆/模组/COC/026黑水溪/bgm/heishuixi.cues.json')
console.log('hasCookie:', s.hasCookie, '| nickname:', s.nickname || '(空)')

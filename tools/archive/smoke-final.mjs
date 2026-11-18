import { apply } from '../lib/index.js'
import { Workbench } from '../lib/ui.js'
const tools = new Map()
apply({ tools: { register: (t) => tools.set(t.name, t) }, logger: { info() {}, warn() {} } })
console.log('已注册工具:', [...tools.keys()].join(', '))
const wb = new Workbench({ getTools: () => tools, logger: {} })
const snap = await wb.snapshot('F:/Data/听枫馆/模组/COC/080天体之音/bgm/tianti.cues.json')
console.log('快照 ok:', snap.stats, '| hasCookie:', snap.hasCookie, '| fields:', snap.cookieFields)

# 配乐插件测试：遇到的问题与修复方案

> 来源：`bgm-prep-test` 端到端测试，`test-runs/20261118-080859-border-post/`（3 段新编场景 / 24 个候选 / 24 首全部标注 / 墙钟 2m29s）。
> 状态：**全部已修**（I7 在 0.11.1，其余在 0.11.2，2026-11-18）。逐条落点见 §11。
> 后续版本改动（0.12.x）已超出本文范围，摘要见 §11 末尾的「0.12.x 之后的替换」。
> 关联：[TODO.md](TODO.md) §1（人声探测去留）；[DETAIL.md](DETAIL.md) 的「已知限制」；[WORKFLOW.md](WORKFLOW.md)。
> 更新：2026-11-18 补 I6 / I7 / I8，并按 I3-A 方案完成全部修复。

---

## 0. 一页看完

| # | 问题 | 影响 | 严重度 | 状态 |
|---|---|---|---|---|
| I1 | `bgm_fetch` 把「尚未定选」报成「待检索」 | 连续检索后仍提示「还有 3 段待检索」，agent 和人都被误导 | 低（文案） | 已修 0.11.2 |
| I2 | `analysis.vocal` 的 `null` 每次读表都被改写成 `0` | 「不知道有没有人声」被固化成「确定没有人声」，数据不可信 | **中** | 已修 0.11.2 |
| I3 | 人声否决（×0.85）是死分支 | 「忌人声」在排序上等于没设；候选里留人声曲 | 中 | 已按 A 落地 0.11.2（B/C 仍待定，见 [TODO](TODO.md) §1） |
| I4 | `avoids` 字段完全无效 | 用户写下的忌讳不进检索、不进打分、也不展示 | 中 | 已修 0.11.2 |
| I5 | 文档与工具描述称「搜歌不可用」，与现状不符 | 检索能力被低估；CLI 搜歌来的候选没有来源，无从复核 | 低（文档） | 已修 0.11.2 |
| I6 | 工作台打开是空白，「历史」里也找不到测试表 | 相对路径被用错 cwd 解析 + 客户端吞掉错误，白屏无任何提示 | **中** | 已修 0.11.2（F1/F2/F3） |
| I7 | 试听一律「这首放不了」 | 浏览器按系统代理去拉 CDN，代理进程却没起；只有播放受影响 | 中（环境） | 已实施 0.11.1，试听已恢复 |
| I8 | 点进度条跳转经常没反应 | 进度条只有 4px 高，命中区=视觉区；点偏了就静默失手 | 中（交互） | 已修 0.11.2 |

八条里 **I2 最小、收益最大**：一行判定写错，导致测试数据里 16/24 首的 `vocal` 是假的。
**I6 最影响验收**：它让「测试跑完了」这件事看上去像没跑。**I7 最容易被误判成插件坏了**，实际是环境。
**I8 最像「功能没做」，其实功能是好的**——`206 + Range` 实测正常，只是鼠标点不到那 4px。

---

## 1. I1：`bgm_fetch` 把「未定选」算成「待检索」

### 现象

逐段检索三次（`cue_ids: ["s1"]` / `["s2"]` / `["s3"]`），每次返回都是：

```
已取候选：1 段，调用 5 次
还有 3 段待检索；看候选用 bgm_view（带 cue_ids），选完用 bgm_pick。
```

而 `bgm_view` 同时显示三段各有 8 首候选。那句话里的「3 段」从头到尾没变过。

### 证据

- [lib/index.js:450](../lib/index.js#L450)：`pending` 的判定是 `c.need_bgm && !c.picks?.primary?.song_id` —— 数的是**没有定选**的段。
- [lib/index.js:458-460](../lib/index.js#L458-L460)：同一变量被写成「还有 N 段**待检索**」。
- 入参筛选用的却是另一套语义（[lib/index.js:376-383](../lib/index.js#L376-L383)：`cue.candidates.length > 0` 就跳过）——所以「检索」和「定选」在代码里本来就是两件事，只有返回文案把它们混在一起。

### 根因

一个变量承担了两种含义：「没有候选」和「没有定选」。选段逻辑用前者，摘要用后者。

### 方案

**A（推荐）**：拆成两个计数，文案分开。

```js
// lib/index.js:449 之后
await writeSheet(file, sheet)
const undecided = sheet.cues.filter((c) => c.need_bgm && !c.picks?.primary?.song_id)
const unfetched = undecided.filter((c) => c.state !== 'ready')
const parts = []
if (unfetched.length > 0) parts.push(`还有 ${unfetched.length} 段没有候选（待检索）`)
const pendingPick = undecided.length - unfetched.length
if (pendingPick > 0) parts.push(`${pendingPick} 段已有候选，待定选`)
parts.push('看候选用 bgm_view（带 cue_ids），选完用 bgm_pick。')
return { ok: true, filled, insufficient, errors, quotaUsed: ..., remaining: budget.left, next: parts.join('；') }
```

**B（最小改动）**：只把文案改成「还有 N 段待定选」，不动判定。够用，但以后真要查「哪几段还没候选」还是得自己数。

### 影响面

`lib/index.js`（`bgm_fetch` 的 execute / render）。`test/fetch.test.mjs` 目前没有断言这句文案，改动不会破测试，建议顺手补一条。

### 验收

复跑 `bgm-prep-test`：第三次 `bgm_fetch` 之后应显示「3 段已有候选，待定选」，而不是「还有 3 段待检索」。

---

## 2. I2：`vocal: null` 在每次读表时被改写成 `0`

### 现象

本次 24 个候选的 `analysis.vocal`：**前 16 首是 `0`，最后 8 首是 `null`**。全部同引擎（`music2emo-v1`）、同一次运行写入。`analysis.stability` 同样全是 `0`（本该是 `null`）。

### 证据

- 写入时是 `null`：[lib/analyze.js:588](../lib/analyze.js#L588)

  ```js
  vocal: null, // music2emo 不输出人声概率；留字段给后续模型
  stability: hit.stability ?? null,
  ```

- 读表时被改写：[lib/store.js:194-195](../lib/store.js#L194-L195)

  ```js
  vocal: Number.isFinite(Number(a.vocal)) ? Number(a.vocal) : null,
  stability: Number.isFinite(Number(a.stability)) ? Number(a.stability) : null,
  ```

  `Number(null) === 0`，而 `Number.isFinite(0) === true` —— 于是「未知」被判成「0」，顺利通过检查。

- 时机对得上：`writeSheet` 不归一化（[lib/store.js:68-79](../lib/store.js#L68-L79)），归一化只发生在**读表**（[lib/store.js:104](../lib/store.js#L104)）。所以：

  | 步骤 | 效果 |
  |---|---|
  | `bgm_tag s1` | 写入 8 首 `null` |
  | `bgm_tag s2` | 先读表 → s1 的 8 个 `null` 变 `0` → 写回；s2 新增 8 个 `null` |
  | `bgm_tag s3` | 再读表 → s1、s2 全 `0` → 写回；s3 新增 8 个 `null` |

  最终落盘：16 个 `0` + 8 个 `null`，与实测分布完全一致。**只要再读一次表并写回，最后那 8 个也会变 0。**

### 根因

用 `Number.isFinite(Number(x))` 当「是否为数字」的守卫。这个写法把 `null`、`undefined`、`''` 都转成 `0` 放行，等于把「缺失」和「零值」压成同一个值。

### 方案

**A（推荐）**：先判空，再判数字；两个字段共用一个工具函数。

```js
// lib/store.js 顶部
function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

// normalizeCandidate 里
vocal: finiteOrNull(a.vocal),
stability: finiteOrNull(a.stability),
```

**B**：给 `vocal` 加语义（如 `-1` 表示未知）。不推荐——引入魔术值，下游还得记规则。

### 影响面

`lib/store.js`（`normalizeCandidate`）、`test/migrate.test.mjs`（旧表迁移断言）、`test/score.test.mjs`。改完后历史表里的旧 `0` 无法自动区分真伪，只能在重新打标时覆盖。

### 历史数据清洗（2026-11-18 08:41 已执行）

判据：`music2emo` 没有 vocal 头，`analysis.vocal` 只可能是「写入时的 null」或「读表时被压出来的 0」。
佐证：`analysis.db` 里 `music2emo-v1` 的 58 条**全部**是 `null`（写入路径从不产生数字）；
所有曲目表里 `music2emo-v1` 的 vocal 数字**清一色都是 0**、没有任何其它取值——真实的概率字段不会有这种分布。

清洗结果：

| 位置 | 条数 | 处理 |
|---|---:|---|
| `analysis.db`（`$DSH_HOME/bgm-prep/analysis.db`） | 0 | 本来就没有 0，无需改；备份 `analysis.db.bak-20261118-084103` 仍留档 |
| `buyecheng-3scene.cues.json`（F: 028 不夜城） | 22 | `0 → null`，备份 `.bak-vocal0-20261118-084127` |
| `border-post.cues.json`（本次测试 run） | 16 | 同上 |
| `fog-lighthouse.cues.json`（上一轮测试 run） | 16 | 同上 |
| `demo-3scenes.cues.json`（E: bgm-demo-3scenes） | 14 | 同上 |
| `buyecheng.cues.json`（F: 028 不夜城） | 8 | 同上 |
| **合计** | **76** | 全部修正，0 条删除 |

只改 `analysis.vocal`：每份文件写入前都校验过「抹掉 vocal 后结构与原文件完全一致」。
清洗后再扫：`music2emo-v1` 的 vocal 只剩 `null`（100 条），`0` 与其它数字均为 0 条；`%TEMP%` 里的一次性夹具 0 条命中。

### 验收

一段 `bgm_tag` 跑完 → 读表 → 再写回 → 再读，`vocal` / `stability` 应始终保持 `null`，不回落到 `0`。可加单测：`normalizeSheet` 对 `vocal: null` 幂等。

---

## 3. I3：人声否决是死分支，「忌人声」等于没设

### 现象

第 3 段（边境邮局 · 无人认领的包裹）目标写了 `vocal: "none"`、`avoids: ["人声","欢快"]`，最终候选里仍有《恋人》（0.603）、《小半》（0.698）、《如果呢》（0.708）、《海屿你》（0.526）这些人声流行曲。它们的段内得分只被目标匹配压低，**没有被人声规则否决**。

### 证据

- `music2emo` 不输出人声概率，插件自己注明了：[lib/analyze.js:588](../lib/analyze.js#L588)。
- 打分里的否决要求 `vocal > 0.5`：[lib/score.js:57-61](../lib/score.js#L57-L61)、工作台镜像同一段：[lib/client.js:286-287](../lib/client.js#L286-L287)。
- 本次 24 首里 `vocal` 为 `0` 或 `null`，**无一超过 0.5** → ×0.85 从未触发。
- 唯一还在起作用的人声防线是标题关键词：[lib/filter.js:172](../lib/filter.js#L172)

  ```js
  if (tags.vocal === 'none' && /(vocal|派)|feat\.?|ft\./i.test(haystack)) score -= 1
  ```

  只命中英文标记与「派」；《恋人》《小半》这类中文歌名不命中。

- **口径提醒**：本次是合成测试场景，不是真实模组。但 TODO §1 等的正是「明明要纯音乐、候选却混进带唱的且没被压下去」这条证据，本次现象符合。

### 方案

**A（0 成本，先做）**：承认现状。删掉或注释死分支，避免后来者以为有防线；`vocal` 字段保留给后续模型，`null` 表示未知（配合 I2）。

**B（推荐中期）**：复用 CLAP 只算人声。旧 `tools/tag/analyze.py` 里有 `VOCAL_PROMPTS`，接回后每首几秒，把比例写进 `analysis.vocal`，×0.85 立即复活。代价是第二个 Python 环境（`E:\Software\audioml`）与更长的标注时间——本次单首 ≈2.2–3.6s，加一路 CLAP 后按经验会翻倍。

**C（最准、最重）**：专用人声/器乐分类器。为一个非核心维度加一层管线，不推荐。

**D（低成本补丁，可与 A 并行）**：把 `filter.js:172` 的启发式扩到 `album + source`，并把 CLI 搜歌结果里「歌名即流行曲」的样本降权——治标，但能让《恋人》这类先掉下去。

### 影响面

`lib/analyze.js` / `tools/m2e/analyze.py`（或另起一路）、`lib/score.js`、`lib/client.js`、`settings.json`（是否开启人声分析）。

### 验收

用第 3 段同款目标重跑：人声流行曲的段内得分应低于钢琴纯音；若走 B，`analysis.vocal` 应有 0–1 的实际分布，且《恋人》之类 > 0.5。

---

## 4. I4：`avoids` 字段是纯装饰

### 现象

三段都写了 `avoids: ["人声","欢快"]` / `["人声","旋律太甜"]`，但候选池与排序看不出任何影响：第 3 段仍有人声流行曲，第 2 段的 `Doopravdy` 仍以 `party: 0.81` 的标签进入候选（#4，0.481）。工作台里也看不到 `avoids`。

### 证据

- 建表接收：`lib/index.js:215-216`、`lib/index.js:248-249`、`lib/store.js:173`。
- 检索只用 `wants[0]`：[lib/search.js:58](../lib/search.js#L58)、[lib/search.js:104](../lib/search.js#L104)；`avoids` 一次都没被读。
- 过滤/打分里名字相似的 `avoid` 参数是 **song_id 集合**，与 `cue.avoids` 无关：[lib/filter.js:189-196](../lib/filter.js#L189-L196)。
- 工作台只渲染 `wants`：`lib/client.js:834-835`。
- 检索结果 `note` 为空，说明也没有「因 avoids 失败」这类记录。

### 根因

按规格实现了一半：schema 与落盘做了，消费端没接。

### 方案

**A（推荐）**：把 `avoids` 翻成两类约束，接到已有链路。

1. **标签侧（打标之后）**：复用 `lib/target.js` 的中文→标签映射，得到应否定的标签集合；在 `rankCandidates` 里扣分，与 target 权重同量纲：

   ```js
   // lib/score.js
   const penalty = (cue.avoidTags ?? []).reduce((sum, { tag, weight }) => {
     const p = Number(candidate?.analysis?.probs?.[tag])
     return Number.isFinite(p) ? sum + weight * Math.max(0, Math.min(1, p)) : sum
   }, 0)
   score = Math.max(0, score - Math.min(0.3, penalty))
   ```

2. **文本侧（检索阶段）**：能落到标题/专辑/歌单名的词（如「摇滚」「儿童」「圣诞」）走现成的 `directives[].effect.exclude_keywords`（`lib/filter.js:166-169`），不必新增机制。

3. **不可判定的**（「人声」这类音乐模型测不出来的）不假装能过滤：在建表返回与工作台上标「无法自动验证」，并指回 I3。

**B（最省事）**：明确文档化「`avoids` 仅记录、不参与检索」，同时在 `bgm_init` 返回里提示一句。零改动，但用户写的忌讳永远没用。

### 影响面

`lib/target.js`（映射复用）、`lib/score.js`（新增否定项）、`lib/client.js`（同口径镜像 + chip 展示）、`lib/filter.js`（文本侧）、`docs/WORKFLOW.md`（说明哪些 avoids 可验证）。

### 验收

建表写 `avoids: ["欢快"]` 的场景，候选里 `happy/upbeat/party` 概率高的曲子得分应低于同目标下未写 `avoids` 时；工作台上能看到 avoids chip 与「无法自动验证」的标注。

> **2026-11-18 后续（0.12.0）**：这一条的实现被「负向标签 `avoidTargets` + 乘性惩罚」替换——
> `avoids` 里能映射成原生标签的自动转成 `avoidTargets`，打分用
> `base × (1 − 0.6·Σ w⁻·p)`；本节描述的「加法扣分（封顶 0.3）」已删除，不再并存。
> 详见 `CHANGELOG.md` 的 0.12.0 与 `docs/WORKFLOW.md` §4「负向标签」。

---

## 5. I5：文档与工具描述落后于检索现状

### 现象

工具描述和 `DETAIL.md` 都称「当前应用未被授权 `search/song`，检索只能走歌单」。但本次第 3 段的 8 个候选里有 **5 个没有 `source` 字段**（《恋人》《小半》《如果呢》《海屿你》《钢琴 悲伤 氛围感 冲突》），而代码里唯一不写 `source` 的入口就是 CLI 搜歌。

### 证据

- 工具描述：[lib/index.js:338-340](../lib/index.js#L338-L340) —— 直接写给模型看的，「检索单元是歌单而不是歌曲搜索（当前应用未被授权 search/song 接口）」。
- 文档：[DETAIL.md:41](DETAIL.md) —— 「`search/song` 接口被平台按应用权限拒绝（300），检索只能走歌单」。
- 代码注释早就写清了：[lib/ncm.js:346-348](../lib/ncm.js#L346-L348) ——「数据类操作（搜歌、读歌单曲目、建歌单、加曲）走官方 CLI 的动态命令……HTTP 接口上被应用权限挡住了（300）。CLI 通道用的是另一套授权，实测可用。」
- 每次都补一次搜歌：[lib/search.js:137-147](../lib/search.js#L137-L147)；CLI 入口 `lib/ncm.js:397-399`。
- 本次 `note` 全为空 → 没有 300 报错；第 3 段候选因此混进了真·流行歌。
- 顺带：CLI 搜歌结果不带 `source`（`lib/search.js:140` 直接 `tracks.push(...)`，而歌单路径会 `{ ...t, source: target.name }`），所以工作台「来源」列对这 5 首是空的，人工复核时看不出它们从哪来。

### 根因

文档停留在「只有 HTTP 通道」的阶段；CLI 通道上线后没同步。以及 CLI 路径没打来源标记。

### 方案

1. 改口径：**检索 = 歌单检索（主）+ CLI 搜歌（补）**；HTTP 的 `search/song` 仍不可用，但不影响搜歌能力。同步改 `lib/index.js:338-340` 的工具描述与 `DETAIL.md` 的「已知限制」。
2. 给 CLI 结果补来源：`lib/search.js:140` 改成 `(...).map((t) => ({ ...t, source: '歌曲搜索' }))`（或带上检索词，如 `歌曲搜索：钢琴 悲伤`），工作台与复核文档就能追溯。
3. 搜歌会带进人声流行曲（本次即例），与 I3 一起看——不要把「搜歌可用」当成纯收益。

### 影响面

`lib/index.js`（描述）、`lib/search.js`（source）、`DETAIL.md`、`README.md`。

### 验收

新跑一段后，所有候选都有 `source`；工具描述与 `DETAIL.md` 不再声称「检索只能走歌单」。

---

## 6. I6：工作台打开是空白，「历史」里也没有测试表

### 现象

测试跑完（3 段、24 个候选全部标注），打开侧边栏「配乐工作台」：

- 主面板空白，标题右边是「0/0 已选 0 段」，中间只有一个「加一段」按钮，**没有任何报错**；
- 「历史」弹窗里只有两条 2026-11-16 的歌单（天体之音、通向庭院之歌），今天的测试表不在。

### 证据

- 直接打工作台接口（本机回环，只读）：

  ```json
  POST /bgm-prep/api/snapshot {}
  → { "active": "test-runs/20261118-080859-border-post/border-post.cues.json",
      "sheet": null,
      "error": "找不到曲目表：test-runs/20261118-080859-border-post/border-post.cues.json" }
  ```

  也就是说：状态里记着这份表，但工作台**读不到**它。

- `ui-state.json` 里的 `active` 是**相对路径**，而这份表实际在
  `E:\Data\Project\DeepSeekHarness\DSH-Homemade-Plugins\dsh-bgm-prep\test-runs\…`。

- 相对路径被原样存下来：[lib/index.js:972](../lib/index.js#L972) 的 `rememberSheetFile(args.file)` 用的是 agent 传进来的**原文**，不是解析后的绝对路径。同一次调用里工具自己是解析过的（[lib/index.js:44-46](../lib/index.js#L44-L46)，按 `exec` 里的**会话 cwd**）。

- 工作台解析用的是**另一个 cwd**：[lib/ui.js:237](../lib/ui.js#L237)

  ```js
  const exec = { agent: { session: { header: { cwd: process.cwd() } } } }
  ```

  `process.cwd()` 是 DSH 宿主进程的目录（安装目录），不是会话工作区。于是同一份表：

  | 场景 | 解析基准 | 结果 |
  |---|---|---|
  | 工具调用（`bgm_init/fetch/tag`） | 会话 cwd = 工作区 | 能读写 |
  | 工作台（`snapshot/open`） | 宿主进程 cwd | **ENOENT** |

- 错误被客户端吞掉：`snapshot` 出错时返回 `{active, sheet: null, error}`，但客户端只处理 HTTP 层错误（`ApiError`），不看 `data.error`；同时
  `hasSheet = Boolean(data.active)`（[lib/client.js:636](../lib/client.js#L636)）——路径坏了也算「有表」，于是顶栏的「分析听感／检索全部」照常显示，主区却渲染成 0 段。
  「最近打开」列表只在 `hasSheet === false` 时渲染（[lib/client.js:783-792](../lib/client.js#L783-L792)），所以这个坏掉的 `active` 恰好把唯一能自救的入口也挡住了。

- 「历史」为什么没有：`history.json` 只由 `bgm_commit` 成功后追加（[lib/ui.js:59-72](../lib/ui.js#L59-L72)），标题就是「歌单历史」。`bgm-prep-test` 明确规定不做 `bgm_commit`，所以测试表**按设计**不会出现在那里。而历史接口其实已经顺带返回了 `recent`（[lib/ui.js:382-391](../lib/ui.js#L382-L391)），客户端没有用它。

### 根因

两处叠加：

1. **路径规范化缺一层**：相对路径被原样写进 UI 状态，之后又被另一个 cwd 解析。
2. **打开失败在客户端不可见**：`active` 有值 = 有表，错误字段没人读，于是退化成「看起来正常、其实是空表」。

### 方案

**F1（Host，需重启 DSH 生效，根修）**：记住的是绝对路径。

```js
// lib/index.js:970-975（工具包装层）
async execute(args, exec) {
  const result = await tool.execute(args, exec)
  if (result?.ok && typeof args?.file === 'string') {
    try { await rememberSheetFile(resolveFile(args.file, exec)) } catch { /* 记不住不影响工具 */ }
  }
  return result
}
```

同时给「打开」兜底：`lib/ui.js:244-250` 的 `open` 用 `path.resolve(file)` 再 `rememberSheetFile`；`rememberSheetFile` 内按解析后的路径去重（现在同一份表会留下「相对 + 绝对」两条，本次状态里就已经出现）。

**F2（Client，需重建前端）**：不再吞错。

```js
const hasSheet = Boolean(data.active) && !data.error
// snapshot 带 error 时：详情区显示横幅（含 file 与「从最近打开里选」），并把「最近打开」列表照常渲染出来
```

**F3（Client，顺手）**：「历史」弹窗加一个「最近打开的曲目表」分区——`history` 接口已经在返回 `recent`，纯前端渲染，零接口改动。

### 已做的临时处置（2026-11-18 08:18）

不改代码，用工作台自己的接口把 `active` 指回绝对路径：

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:3617/bgm-prep/api/open' -Method Post `
  -ContentType 'application/json' `
  -Body '{"file":"E:\\Data\\Project\\DeepSeekHarness\\DSH-Homemade-Plugins\\dsh-bgm-prep\\test-runs\\20261118-080859-border-post\\border-post.cues.json"}'
```

返回 `cues=3`、每段候选 8 首；刷新工作台面板即可看到本次测试表。**这只是绕开症状**，下次再用相对路径跑测试还会白屏——要根治得做 F1。

### 影响面

`lib/index.js`（工具包装层）、`lib/ui.js`（`open` / `rememberSheetFile` / 历史接口）、`lib/client.js`（错误态与最近打开）、`ui-state.json` 的旧相对条目（迁移或忽略）。

### 验收

1. 用**相对路径**建一份表（`test-runs/xxx/a.cues.json`），刷新工作台——应直接显示，不再是白屏。
2. 把 `ui-state.json` 的 `active` 手动改成不存在的路径——应看到明确错误并可点「最近打开」自救，而不是「0/0」。
3. 「历史」弹窗里能看到最近打开的曲目表（不只是建过的歌单）。

---

## 7. I7：试听一律「这首放不了」（代理开着、进程没起）

### 现象

工作台能打开、3 段候选和得分都在，但点播放每首都弹「这首放不了」，进度条原地不动。看上去像插件坏了。

### 证据

- `GET /bgm-prep/api/audio?id=1321401199` → **302**，`location` 指向 `m10.music.126.net/…flac`：宿主取直链是正常的。
- 直连同一 URL（`Invoke-WebRequest -NoProxy`，`Range: bytes=0-1023`）→ **206**，1024 字节，`audio/mpeg`：网络本身通。
- 走系统代理访问同一 URL → `目标计算机积极拒绝 (127.0.0.1:7897)`。
- 注册表：`ProxyEnable=1`、`ProxyServer=127.0.0.1:7897`、`ProxyOverride` 只有 `localhost;127.*;内网段`；`Get-NetTCPConnection` 查 7897 **没有监听**——代理进程没起来。
- 真实 Chrome 打开 `m10.music.126.net` 和 `www.baidu.com` 都落到 `chrome-error://`：浏览器侧外网**全断**，不只网易云。

### 根因

浏览器（含 DSH 桌面端的 Chromium）按系统设置走代理，而代理进程没起。`<audio>` 拉 CDN 那一跳是**浏览器**发出的，所以只有播放坏；界面其余部分都走 `127.0.0.1`（在绕过列表里），不受影响。听感分析在 Python 里直连、宿主取直链用 Node，都不读系统代理——于是「分析能跑、直链能取、浏览器放不了」。

### 方案

| 方案 | 做什么 | 代价 |
|---|---|---|
| A（用户侧，30 秒） | 启动跑在 7897 的代理软件，或关掉系统代理 | 临时；开关代理时会再坏 |
| B（用户侧，长期） | 把 `*.music.126.net` 加进 `ProxyOverride` | 改系统设置；代理开着也能播 |
| **C（插件侧，已实施 0.11.1）** | 音频改**宿主取流再转发**，浏览器只跟 `127.0.0.1` 说话 | 音频流量过本机服务；需支持 Range，否则拖不动进度条 |

C 的具体改动：

- 新增 [lib/audioProxy.js](../lib/audioProxy.js)：`openUpstream`（打开上游、最多跟 3 跳重定向、15s 超时）、`passthroughHeaders`（只放行 `content-type` / `content-length` / `content-range` / `etag` / `last-modified`，并按直链等级兜底 content-type）、`pipeUpstream`（出错掐断、客户端关闭就销毁上游）。
- [lib/ui.js](../lib/ui.js) 的 `audio()` 不再 302：宿主取到 206/200 后原样流给浏览器，状态码与 `content-range` 都保留，所以拖动进度条依然工作。
- 直链缓存 5 分钟：拖进度条会连发多个 Range 请求，避免每次都调一次 `weapi`。
- 实测两条真实直链（`m10` 的 mp3、`m704` 的 flac）都能拿到 206 与前 2 KB 字节；`m704` 把 `content-type` 报成 `application/octet-stream`，已按 `level=lossless` 补成 `audio/flac`。

### 影响面

`lib/audioProxy.js`（新）、`lib/ui.js`（`audio()`）、`test/audioProxy.test.mjs`（新，8 个用例）。**需重启 DSH 生效**（宿主模块在启动时装载）。

### 验收

1. ✅ 重启 DSH 后刷新工作台，点任意候选能出声（2026-11-18 已确认：播放正常、时间在走）。
2. ✅ 拖动/点击进度条 → 声音能从中间接上（206 与 `content-range` 生效；UI 的点击命中有问题，见 I8）。
3. 待验：保持「系统代理开着、代理进程没起」这个原失败条件，仍应能播——这正是这次要修掉的那一格。

> 后续观察：播放恢复后暴露出 I8（进度条命中区只有 4px）。服务端的 seek 能力已实测正常，不是这次改造的回归。

---

## 8. I8：点进度条跳转「没反应」（命中区只有 4px）

### 现象

I7 修好后播放正常了，时间在走，但**点进度条中间经常什么也不发生**：时间不跳、没有提示，看起来像「不能拖动」。

### 证据（在 GUI 里实测）

在 `http://127.0.0.1:6680` 的工作台里播《Death Waltz》（4:27），在同一个横坐标上只改纵坐标：

| 点击位置（CSS px） | 结果 |
|---|---|
| `(1500, 1193)` 连续两次 | 没反应，时间照常 `0:07` → `0:19` |
| `(1500, 1197)` | **立刻跳到 `2:10`**，随后正常播到 `2:21` |

也就是说：**服务端和服务链路都没问题**（206 + `content-range` 早前已实测），失手的是点击命中。

- [lib/client.js:197](../lib/client.js#L197)：`.bgm-bar{position:relative;flex:1;height:4px;...}` —— 进度条本体只有 **4px 高**，可点区域就是这 4px。
- 它外面包着 `.bgm-seek{display:flex;align-items:center}`（[lib/client.js:196](../lib/client.js#L196)），所以**视觉中心**（时间数字的竖直中线）和进度条的 y 并不重合；按「中间」去点，很容易落到父容器上。
- 父容器、时间文字都没有点击处理，点空 = 静默失手，没有任何反馈。

### 根因

命中区 = 视觉区（4px），既没扩命中区，也没有「点空」的反馈。功能本身是好的——之前播放整个坏掉，所以没人能测到这一步。

### 方案

**A（推荐，纯 CSS，一行）**：用伪元素把命中区撑高，视觉保持 4px。

```css
.bgm-bar::before{content:'';position:absolute;left:0;right:0;top:-8px;bottom:-8px}
```

命中高度 4px → 20px；伪元素属于 `.bgm-bar`，指针事件仍然落到它身上。（**0.12.2 又改成 16px 高的原生容器**，见 §11 末尾。）

**B（配套，体验更好）**：把 `onClick` 换成 `onPointerDown` + `onPointerMove`，支持按住拖（现在只能单击跳一次）。拖动时按 100ms 节流写 `currentTime`，松手再写最终值，避免每个 pointermove 都触发一次 Range 请求。

**C（可选）**：拖动时在鼠标旁显示时间气泡；不做也不影响可用。

### 影响面

`lib/client.js` 的 `styles`（`.bgm-bar`）与 `.bgm-seek` 的事件绑定；只改客户端。生效方式取决于 DSH 怎么打包客户端插件：保守做法是**重启 DSH**（宿主启动时重建客户端包），只刷新页面不一定够。

### 验收

1. 在进度条上下各 8px、左右任意位置点击，都能跳转；
2. 按住拖动时时间连续变化，松手停在松手位置；
3. 视觉上进度条仍然是细线，没有变成粗条。

---

## 9. 次要观察（不算缺陷，供参考）

| 观察 | 说明 |
|---|---|
| 同艺人上限 2 首正好被打满 | `lib/filter.js:204-220` 规定同一艺人/专辑最多 2 首；本次三段各有一对同艺人：Sainkho ×2、Kevin MacLeod ×2、Sing2Piano ×2。说明候选池偏薄，不是上限设错 |
| 第 3 段前三名几乎并列 | 0.762 / 0.763 / 0.767 —— `sad / melancholic / emotional` 高度相关，目标权重很难区分。若要让排序有区分度，可考虑给主目标更高权重（如 sad 0.55） |
| `wants` 直译成歌单检索词有风险 | 第 1 段 `wants: ["低频 氛围"]` 命中了「低频次声波」「【低频 狂潮】沉浸式车载低音盛宴」两个车载低音歌单，捞进 `Lost Rivers`（图瓦喉音）、`Mans Not Hot`（说唱）。`wants` 宜写风格词（「暗黑 弦乐」）而不是声学特征 |
| 返回里的 `remaining` 不是全表预算 | 每次 `bgm_fetch` 都用 `settings.fetchBudget` 重新计一次（`lib/index.js:369`），返回的 `remaining` 只对本次调用有意义 |
| 备份保留 3 份 | `pruneBackups(file, 3)`（`lib/store.js:86-99`）；本次目录里正好 3 个 `.bak-*`，符合预期 |

---

## 10. 怎么复验

```powershell
# 1) 单测（改完任何一条都先跑这个）
npm test

# 2) 重新生成计时报告（只看本次测试的耗时口径）
node ".dsh/skills/bgm-prep-test/bin/timing.mjs" --file "test-runs/<runId>-<slug>/<slug>.cues.json"
```

复跑端到端测试时，重点看五处：

- [ ] 第 3 次 `bgm_fetch` 返回的是「已有候选，待定选」，不是「待检索」（I1）
- [ ] 打标后读表再写回，`analysis.vocal` 不会从 `null` 变 `0`（I2）
- [ ] 写 `avoids` 的场景，候选与工作台能看出影响或明确标「无法验证」（I4）
- [ ] 所有候选都有 `source`（I5）
- [ ] **用相对路径跑完，刷新工作台能直接看到这份表**，不需要先手工点「打开」（I6）
- [ ] 点候选能出声；系统代理开着（进程没起）也不受影响（I7）
- [ ] **进度条上下各 8px、左右任意位置点下去都能跳**，不再出现「点了没反应」（I8）

---

## 11. 修复记录（0.11.2，2026-11-18）

八条全部落地，I3 按 A 方案。逐条对应：

| 条目 | 改了什么 | 落点 |
|---|---|---|
| I1 | 拆成「没有候选（待检索）」与「已有候选（待定选）」两个计数 | `lib/index.js` |
| I2 | 新增 `finiteOrNull`，取代 `Number.isFinite(Number(x))` 的判数字写法 | `lib/num.js`（新）、`lib/store.js`、`lib/analyze.js` |
| I3-A | 删掉 `vocal > 0.5 → ×0.85` 死分支；测试改成「vocal 不影响得分」 | `lib/score.js`、`lib/client.js`、`test/score.test.mjs` |
| I4 | `avoids` → `avoidTags` / `avoidKeywords` / `avoidUnverified`；打标后按标签概率扣分（封顶 0.3）、检索阶段按标题关键词扣分、工作台 chip、`bgm_init` 返回提示 | `lib/target.js`、`lib/store.js`、`lib/score.js`、`lib/filter.js`、`lib/index.js`、`lib/ui.js`、`lib/client.js` |
| I5 | 工具描述与 `DETAIL.md` 改成「歌单为主 + CLI 搜歌补充」；CLI 搜歌结果补 `source` | `lib/index.js`、`lib/search.js`、`lib/ncm.js`、`docs/DETAIL.md` |
| I6 | F1 工具记绝对路径；F2 客户端读表失败显示原因并保留「最近打开」；F3「历史」弹窗加「最近打开」分区 | `lib/index.js`、`lib/client.js` |
| I7 | 音频改宿主取流（0.11.1，已完成） | `lib/audioProxy.js`、`lib/ui.js` |
| I8 | `.bgm-bar` 命中区 4px → 20px；`onClick` 换成指针事件 + 按住拖动（80ms 节流）（0.12.2 改为 16px 容器） | `lib/client.js` |

**验证**：`npm test` → 74 个测试通过（新增：null 不会被写成 0、avoids 三类映射、
忌讳扣分与封顶、`avoidKeywords` 压低命中曲、`analysis.vocal` 不再影响得分）。

**仍需决定（不在本次范围）**：

- 人声探测接不接回（B/C 方案，见 [TODO](TODO.md) §1）——现在只是不再假装有防线；
- `wants` 直译成歌单检索词的质量问题（见 §9 次要观察），属于检索策略取舍。

### 0.12.x 之后的替换（本文写完之后发生的）

| 版本 | 替换了什么 | 现在的做法 |
|---|---|---|
| 0.12.0 | I4 的「加法扣分（封顶 0.3）」被替换 | `avoidTargets` + 乘性惩罚 `base × (1 − 0.6·Σw⁻·p)`，见 [WORKFLOW](WORKFLOW.md) §4 |
| 0.12.1 | 界面用词与强度档位 | 「忌」改「负向标签」，去掉轻/中/重、直接显示权重；设置里加 `avoidEnabled` 总开关 |
| 0.12.2 | I8 的「伪元素扩命中区」被替换 | 进度条改成 16px 高容器 + 内部 4px 细线，另加「目标匹配」分解行 |
| 0.12.2 | `bgm_fetch` 返回计数的一个残留 bug | 用 `candidates.length` 判断「没有候选」（原来用 `state`，新建空段也会被算成已有候选） |
---

## 附：3×10 秒切片实验（结论：未采用，2026-11-18）

问题：既然整曲要下载解码、推理按 30 秒段跑，能不能只取「前 10s + 中 10s + 后 10s」来省时间？
本机用同一套 music2emo、同一批已解码缓存实测（RTX 3060 Ti / cu121，16 threads）：

| 曲目 | 时长 | 30s 段数 | 全曲推理 | 3×10s 推理 | 提速 | 概率余弦 | 平均概率差 | Top5 重合 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 小半 | 297s | 9 | 4.57s | 0.42s | 10.8× | 0.969 | 0.069 | 4/5 |
| Weekend | 306s | 10 | 3.42s | 0.48s | 7.1× | 0.934 | 0.084 | 4/5 |
| Lost Rivers | 438s | 14 | 6.43s | 0.44s | 14.6× | 0.972 | 0.046 | 4/5 |

向量层面看着接近，但**段内排序会明显变**：拿雪见温泉 s3 的 8 首候选比，`钢琴` 从第 2 掉到第 7、
`小半` 从第 8 升到第 3、`如果呢` 分数从 0.668 掉到 0.316。对照「只取开头 30 秒」更差
（余弦 0.910、Top5 3/5）。

结论：**保持全曲分析**。推理成本是一次性的（`analysis.db` 按歌缓存），排序稳定性比省几秒更值钱。
若以后确实需要提速，优先考虑「3×10s 粗排 + Top3 全曲精排」的级联，而不是直接替换。

<!-- 由 2026-11-18 的本地实验补记；实验脚本与临时 wav 已清理，未改动插件代码。 -->


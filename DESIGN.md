# 插件设计：跑团配乐·备团（`dsh-bgm-prep`）v3.3

> ⚠️ **已过时，仅作历史记录**：当前设计与实现以 [docs/DESIGN-v4.md](docs/DESIGN-v4.md)、
> [README.md](README.md)、[docs/WORKFLOW.md](docs/WORKFLOW.md) 为准（实现已到 0.12.x）。
> 本文里的工具名（`bgm_create` 等）、数据模型（`version: 1` / `pick`）都已不存在，不要照它施工。

> 状态：**已实现，已安装，17 项测试通过。** 未完成的是「重启后在生产里跑一遍真模组」。
> v3.2 是按「自研软件与工具开发团」6 人审查结果修订的版本；**v3.3 是按实测结果改的**：
> 数据类操作从开放平台 HTTP 改走 `ncm-cli` 动态命令，`bgm_commit` 从「导出清单」改成「真建歌单」。
> 变更清单见 §0 与 `CHANGELOG.md`。所有未实测项一律标「未验证」。

---

## 0. v3.2 改了什么

| 类别 | 改动 | 依据 |
|---|---|---|
| **丢数据** | 文件按 scope 命名；`bgm_init` 默认 `create`，文件存在即**拒绝**；覆盖前 `.bak` | 审查 H1 |
| **丢数据** | 所有写走 `tmp → rename` 原子写；`commit` 写 `commit.json` 回执 | 审查 S2 |
| **丢数据** | `commit` 幂等键改为 `playlist_id`，同名不同 id 一律报错 | 审查 H3 |
| **安全** | 凭据不进会话/工具参数；改由一次性 setup 写本地文件 | 审查 H2 |
| **验收** | 停表规则重写：首次必停，之后按规模 | 审查 H4 |
| **可用** | 表内只保留一种序号（第 k 段），`c0x` 只进文件 | 审查 H5 |
| **删** | `pool.jsonl` + `bgm_pool` 全部删除，改 Config 里 2~5 个种子歌单 + TTL 缓存 | 审查 §4 |
| **删** | `stages`（自相矛盾）、`rendered`（把视图当状态） | 审查 §4 |
| **删** | 「一个场景一种情绪」→ 二期 | 审查 §4 |
| **简化** | 7 个工具 → 5 个；所有工具收一个 `file` 参数 | 审查 §5 |
| **简化** | `state` 7 态 → 3 态 + 派生 | 审查 §4 |
| **简化** | 候选 15 → 8；`bgm_commit` 只建一个歌单 | 架构师 |
| **修正** | 数据目录 `$DSH_HOME/bgm-prep/`（原 `plugin-data` 不存在） | 3 人实测 |
| **修正** | `cues.yaml` → `cues.json`，零运行时依赖 | 架构师 |
| **补** | `source.md` 有明确写入者 | 审查 S1 |
| **补** | 交互协议与提取规则的载体（skill），不再只写在设计文档里 | 审查 C |

---

## 1. 触发模型：文本是原料，需求是扳机

备团时你发进来的东西，绝大多数跟配乐无关。**"看到模组文本 = 要配乐"是错的。**

| 层 | 什么时候 | 做什么 |
|---|---|---|
| **L0 静默** | 贴文本、聊剧情、改设定、问规则 | **什么都不做。** 不提取、不落盘、不花配额 |
| **L1 成表** | 你说要 BGM | 确认范围 → 回捞段落 → 提取 → `bgm_init` → 给你场景表 |
| **L2 跑完** | 表看着对，或你说"就这样" | `fetch` → `pick` → 曲目表 → `commit` |

扳机是一句话：「这局想配点音乐」「第三幕配一下」「码头夜袭那段找个 BGM」「根据上次那个」。

**宁可漏触发，不可误触发。** 「这局想让他们紧张一点」是剧情建议，不是配乐需求。

**"上次那个"怎么找**：不做注册表。agent 用 glob 找 `**/bgm/*.cues.json`，找到后把路径给你确认；找不到就问路径。文件系统本身就是索引。

---

## 2. 架构：插件零模型调用

插件提供**能力**（校验、检索、过滤、落盘、建歌单），agent 提供**判断**（理解、打标、排序）。

三条理由：原文已在 agent 上下文里（不重复读）；品味要一致（不能有两种判断）；纯代码可被固定输入断言。

**代价要说清**：决定这套东西好不好用的那一半——触发识别、范围回捞、`need_bgm` 判定、打标、排序——**一行都不在插件里**，它们是**提示词**。

所以 v3.2 给它们一个正式载体：

```
docs/WORKFLOW.md   ← 交互协议 + 提取规则 + 表版式，通过 skill 按需加载
```

- 用 **skill**（按需加载），不用 `systemPrompt.section()`（每会话常驻，为一个备团工具付全程上下文不划算）。
- 改规则 = 改一个 md，不重新打包、不重启。
- 工具描述压到每个 ≤3 句，细节指向 WORKFLOW.md。

> 具体注册 API 在实现时按 `@deepseek-ai/dsh-skill` 的 README 确认；本稿不写死函数名。

---

## 3. 分工

| 谁 | 做什么 |
|---|---|
| **你** | 平时随便发；开口要 BGM；审表；说"第 3 段太吵" |
| **agent** | 判断该不该动；确定回捞范围；提取与打标；在候选里排序 |
| **插件** | 校验；检索过滤；原子落盘；出表；建歌单 |

**插件永远不猜。** 拿不准的返回 `warnings`。

---

## 4. 数据模型

### 文件布局（按 scope 命名 —— v3.2 关键修正）

```
<模组目录>/bgm/
    s3-act3.cues.json        ← 唯一真相
    s3-act3.source.md        ← 回捞用的原文（有明确写入者，见 §6）
    s3-act3.review.md        ← 给人看的表
    s3-act3.playlist.txt     ← 可粘贴清单（每行「曲名 - 艺人」）
    s3-act3.playlist.csv     ← 同内容，UTF-8 BOM + CRLF，Excel 直接开
    runs/2026-11-16T04-20/ncm.log   ← 每次外部调用的 argv + 原始输出
```

**同一模组的不同幕 = 不同文件，互不覆盖。** 这是 v3.1 最大的漏洞。

`scope` 进文件名前必须 sanitize（去 `\ / : * ? " < > |`、去尾部空格与点、避开 `CON/PRN/AUX/NUL/COM1-9`）；`·` 合法，保留。

### `cues.json`

```jsonc
{
  "schema": 1,
  "module": "猩红文档",
  "session": 3,
  "scope": "s3-act3",
  "source": "s3-act3.source.md",

  "directives": [
    { "text": "这次想更压抑一点", "effect": { "valence": "dark", "tension_bias": 2 } },
    { "text": "少用钢琴",        "effect": { "exclude_texture": ["piano"] } }
  ],

  "cues": [
    {
      "id": "c01",
      "scene": "地窖 · 石桌与封蜡信",
      "trigger": "玩家走下石阶，看见石桌上未拆的信",
      "need_bgm": true,
      "state": "ready",              // ready | skipped | insufficient  ← 只有这三个是存的
      "tags": { "tension": 6, "valence": "dark", "energy": "static",
                "texture": ["drone","strings"], "vocal": "none", "min_len": 180 },
      "candidates": [ { "song_id": 42121234, "title": "...", "artist": "...",
                        "album": "...", "duration": 245 } ],   // 最多 8 首
      "picks": { "primary": { "song_id": 42121234,
                              "why": "低频垫底无鼓点，弦乐中段才抬一次" },
                 "alts":  [ { "song_id": 0, "why": "" } ] },
      "rejected": [ { "song_id": 99, "reason": "副歌记忆点太强", "run": "2026-11-16T04-20" } ]
    },
    { "id": "c04", "scene": "档案室 · 翻卷宗", "need_bgm": false, "state": "skipped", "cues_note": "沿用上一段" }
  ],

  "playlist_id": null      // commit 成功后写入；之后重跑只更新这张
}
```

**派生规则（不存，算出来）**：
- `picked` = 有 `picks.primary`
- `published` = 有 `playlist_id`
- 总进度 = 各 cue 派生状态计数

不存的字段就不会漂移。这是把 7 态压成 3 态的全部理由。

**`rejected` 带 `run` 时间戳**，重跑时只排除**最近一次之前**的记录，避免候选被历史否掉吃光（审查 S3）。`bgm_pick(reset: true)` 可清空指定 cue 的 `rejected`。

### 为什么是 JSON 不是 YAML

`cues.json` 是机器写、机器读，人看的是 `review.md`。Node 没有内置 YAML，引 `yaml` 依赖要你批准；本工作区三个参照插件**全部零运行时依赖**。JSON 能省掉一个依赖和一个批准环节。代价是手写时分号逗号烦——但你不会手写它，你会手改 `review.md` 之后让我同步。

---

## 5. 状态机

```
create ──> ready ──fetch──> 有 candidates ──pick──> 有 picks ──commit──> 有 playlist_id
              │                    │
              │                    └─ 取不到 → insufficient（不硬凑）
              └─ need_bgm:false → skipped（永不消耗配额）
```

判定永远在 cue 级。**没有全局阶段位**——那是 v3.1 自相矛盾的地方，已删。

---

## 6. 工具（5 个）

**所有工具收同一个 `file` 参数**（`cues.json` 的绝对路径）。这一个决定消掉了：目录参数缺失、scope 串号、注册表、配置里那个会重启插件的"最近文件"。

### `bgm_init`
```js
bgm_init({
  file, module, session, scope,
  cues: [{ id?, scene, trigger?, wants?, avoids?, need_bgm? }],
  directives?,
  mode?: "create" | "append" | "patch" | "replace",   // 默认 create
  source_path?, source_text?
}) → { file, cue_count, need_bgm_count, warnings[], table }
```
- **`mode` 语义必须显式，这是 v3.1 的漏洞**：
  - `create`：文件已存在 → **报错**，返回现有 `{cue_count, picked_count, published}`，不写
  - `append`：并入，同 id 冲突报错
  - `patch`：按 `cue.id` 局部改（"第 3 段换个说法"走这个）
  - `replace`：整体覆盖，写前自动 `.bak-<时间戳>`
- `source_path` 或 `source_text`（≤3000 字）二选一：给了就登记到 `source` 字段并校验文件存在。
  **这是 v3.1 悬空引用 `source.md` 的修法**：以前七个工具都不收原文，没人负责写；现在它有明确入口。
- 校验：`scene` 非空、`scope` 非空、`id` 唯一、`model_dir` 可从 `file` 推出。
- 返回里带 **L1 场景表**（不再需要单独调 render）。

### `bgm_fetch`
```js
bgm_fetch({ file, cue_ids?, force?, budget?: 200 })
  → { filled, insufficient[], quota_used, next_action }
```
- 只处理 `need_bgm: true` 且无 `picks.primary` 的 cue；**单次最多 8 个 cue**，超出自行分批（控制返回值体积）
- 检索顺序：Config 里的种子歌单（TTL 缓存，1 小时）→ 不足则模板化搜索 → 去重 → 版本污染过滤 → 每 cue 留 8 首
- 应用 `directives.effect`
- `insufficient[]` 明说"这个场景只有 N 首，可能不对味"
- **不返回候选全文**，只回摘要；候选全文在文件里，需要看时 `bgm_view`

### `bgm_pick`
```js
bgm_pick({ file, picks: [{ cue_id, primary: {song_id, why}, alts?, reject? }], reset? })
  → { accepted, rejected_songs[], hints, table }
```
- **幻觉闸门**：`song_id` 必须在该 cue 的 `candidates` 里，否则整条拒绝并回传合法 id 列表
- `why` 超 30 字截断
- `reset: true` 清空该批 cue 的 `rejected`
- 返回 **L2 曲目表**

### `bgm_commit`
```js
bgm_commit({ file, dry_run? })
  → { playlist, playlistId, added, total, files[], missing[] }
```
- **真的建歌单**（v3.3 起）：`playlist create` + `playlist add`，按段序加主选曲目
- 幂等键 = `cues.json` 里的 `playlist_id`：有就复用，没有才新建；已在歌单里的曲目跳过
- `dry_run: true` 只报告会加几首，不写账号
- 同时导出 `review.md` / `playlist.txt` / `playlist.csv`
- **已知缺口**：CLI 有 `create/add/remove` 但**没有 delete**，建错的歌单只能你在 App 里删。所以默认建议先 `dry_run` 看一眼。

### `bgm_view`
```js
bgm_view({ file, scope?: "cues" | "full", cue_ids? })
  → { table, status }
```
只读。L1 表用于首次确认，L2 表用于审曲目，什么参数都不给就出当前进度。

---

## 7. 交互协议

### 停表规则（v3.2 重写）

| 情形 | 行为 |
|---|---|
| **首次为某个模组跑** | **必停**：先给 L1 场景表，等一句"可以"再跑 |
| 同模组第二次起，`need_bgm` 数 ≥ 8 | 停 |
| 其余 | 不停，直接跑到 L2 |

理由：L1 唯一的价值是校验**提取口径**，这只有第一次是未知量。之后风险退化为"某几段没料"，而单 cue 重跑很便宜。

> 这比 v3.1 的「≤5/≥5」好在两点：不再有 5 处重叠的边界；也不再和验收指标打架（见 PLAN）。

### 表的版式

**L1（场景表）** —— 表内只用一种编号：`第 k 段`。

```
猩红文档 · 第三回 · 第三幕          共 7 段 / 5 段需配乐

第 3 段  地窖 · 石桌与封蜡信
        玩家走下石阶，看见石桌上未拆的信
        [暗 / 静态 / 弦乐 / 无人声]

第 4 段  档案室 · 翻卷宗                            —— 不配乐
```

**L2（曲目表）** —— 在 L1 之上加曲目，并做三处减法：
- 去掉触发行（切分在 L1 已批过；**例外**：该模组没展示过 L1 时保留）
- 备选压成一行编号，不展开
- 连续的不配乐段合并成一行

```
第 3 段  地窖 · 石桌与封蜡信              [暗 / 静态 / 弦乐]
        01 曲名 — 艺人                   4:05
        低频垫底无鼓点，弦乐中段才抬一次        备选 2
```

**不用「折叠」**：Markdown 聊天里的折叠要靠 `<details>` 或平台组件，本机渲染未验证，不作为版式前提。完整备选只在 `review.md` 里。

**不用空格手工对齐**：中日文混排 + 比例字体必错位；改用缩进块。

### 追问路径

| 你说 | 做什么 |
|---|---|
| 第 3 段太吵 | 只重跑该 cue：加 `avoids`，`force` 重取，重排 |
| 整体再暗一点 | 改 directives → 全量重取。**跑前播报"约 N 次调用"** |
| 这首不行 | alts 顺位顶上，旧曲进 `rejected`，不重新检索 |
| 不要这段 | `need_bgm: false`，表里留一行「已移出（说'加回'恢复）」——留撤销口 |
| 加回第 4 段 | 恢复 |

---

## 8. 提取规则（写进 `docs/WORKFLOW.md`）

三种料分开：

- **全局指令**：含"整体/全程/这局/都/一直"或"少用/别用/多一点" → `directives`
- **场景**：推进词（到了/进入/见到/发生/接着/这时）或明确地点、NPC 交锋 → cue，按出场顺序
- **噪声**：属性表、规则数值、无关设定 → 丢弃，**但在表里说明丢了什么**

### 不是每个场景都配乐

- **要给**：情绪强度高（对峙/揭示/战斗/告别）、大段台词需垫底、明显转场
- **不给**：纯调查、规则结算、NPC 闲聊、连续小场景（沿用上一段）

20 场景通常只需 8~10 首。**每 5 分钟切一次音乐会让人麻木。**

### 「一个场景一种情绪」→ 已移到二期

理由：它的收益是情绪转折的过渡，而那是实时播放才用得上；本期不交付收益只付成本。本期按**主导情绪**选一首，遇到转折段在 `trigger` 里记一句"此处情绪转战斗"，留给你开团时判断。

---

## 9. 检索与选曲（v3.3：改走 `ncm-cli` 动态命令）

> **路线推翻过一次**：开放平台 HTTP 的 `search/song`、`playlist/song/list` 都返回 `300 应用未授权`
> （应用权限包决定，登录无解）。但 `ncm-cli` 登录后会注册一整套动态命令，走另一套授权，实测可用。
> 所以数据类操作全部走 CLI，HTTP 只留登录与账号资料。详见 `docs/spike-0.md`。

- **双通道**：搜歌 / 读歌单曲目 / 建歌单 / 加曲 → `spawn(node, [ncm-cli, ...])` + `--output json`；登录与资料 → HTTP
- **种子歌单自动发现**：`seedPlaylists` 留空时，从他自己的歌单里挑「名字含模组名的那张」+「名字带 BGM 的大池子」；跳过多语种大杂烩
- **每段独立检索**：种子曲目一次性读好共用，但每段再加一次「情绪 + 织体」的歌单/歌曲检索，否则所有段落拿到同一批
- **短查询词**：`压抑 纯音乐`、`战斗 黑暗 史诗`。词一多召回就掉一个量级（实测 4 词查询返回 0 条）
- **场景名不进检索**：搜「码头」会得到《想去码头整点薯条》，只按演出功能检索
- **情绪关键词打分**：标题/专辑命中「追逐/悬疑/史诗」等词加分，用来在共用种子池里挑出更像这一段的
- **多样性限流**：同专辑、同艺人最多 2 首，否则一张专辑能把候选表刷屏
- **版本污染过滤**：标题含 `live/现场/翻唱/cover/remix/DJ/伴奏/片段/试听/铃声/抖音`；时长 <90s 或 >900s
- **前奏静音 / 人声**：元数据判不了，`intro_unknown` 只是占位。**明确的能力缺口，不假装解决**

---

## 10. 文件、凭据与诊断

| 东西 | 位置 |
|---|---|
| 数据、缓存、日志 | `$DSH_HOME/bgm-prep/` |
| `cues.json` 及其同伴 | `<模组目录>/bgm/`（跟模组走） |
| 种子歌单 id、候选上限、超时 | 插件 Config |
| AppID / PrivateKey | **`$DSH_HOME/bgm-prep/credentials.json`**，由一次性 `scripts/setup.mjs` 写入，ACL 限当前用户 |

### 凭据（v3.2 修正，这条以前是矛盾的）

v3.1 承诺"PrivateKey 走 DSH 凭据记录、不进日志"，但 `ncm-cli` 必须先 `configure`，配置必然落盘；又因为不做面板，PrivateKey 只剩"当工具参数传进来"一条路——而工具入参会进会话记录。

**改法**：单独跑一次 `node scripts/setup.mjs`，交互式输入并写入本地文件，**PrivateKey 从不经过会话**。
- `setup.mjs` 只做三件事：写 credential 文件（ACL 收紧）、调一次 `configure`、验证 `login` 状态
- 之后所有工具**不接收**密钥参数
- 承诺改成："不进会话、不进 `cues.json`、不进 `review.md`、不进日志"——**不再声称 CLI 不落盘**

### 诊断

每次外部调用落 `runs/<ts>/ncm.log`：argv（**脱敏**，不含 token）+ stdout/stderr 原始字节 + 错误码。
`$DSH_HOME/bgm-prep/logs/` 留最近 10 次。

**编码**：子进程输出按 UTF-8 解码；出现 `\uFFFD` 即判定解码失败并原样落盘，不猜。

---

## 11. 失败模式

| 情况 | 行为 |
|---|---|
| 候选不足 | `insufficient[]` 明说，不硬凑 |
| 不存在的 `song_id` | `bgm_pick` 整条拒绝，回传合法 id |
| `ncm-cli` 未安装 | 给一条可粘贴的安装命令，不重试 |
| **Windows 调 CLI 报 EINVAL** | 用托管 node 直接跑 `dist/index.js`，`shell:false`，绝不拼命令行 |
| 输出乱码 | 判定解码失败，原样落盘 + 报错，不猜 |
| token 过期 | 提示扫码，不静默降级 |
| 文件已存在 | `create` 模式报错并列出现有进度 |
| 同名歌单已存在 | 报错 + 回传 id，让你决定 |
| 目录只读 / 磁盘满 | 中文解释 + 保证不留半截文件（原子写） |
| 中断 | `.tmp` 不会被当成结果；重跑跳过已填的 cue |
| 配额将尽 | 报告并停 |
| 找不到"上次那个" | glob 列出候选让你对号；还不行就问路径 |

---

## 12. 明确不做

- 客户端面板（对话就是入口）
- 实时播放 / 淡入淡出 / 快捷键
- 音频下载、离线缓存、内嵌试听
- 氛围音效（雨声/炉火）
- 版权处理（前提私桌使用）
- 从 PDF/图片读模组
- 「一个场景一种情绪」的拆 cue（二期）
- `pool.jsonl` 与歌单池管理面（改用 Config 种子）
- 建两个歌单（备选留在文件里）
- L0 期主动扫描或存档你贴的文本

---

## 13. 尚未定的

1. 种子歌单从哪来（你给 id / 我用关键词粗筛后你勾）
2. 外语歌词算不算可接受
3. 需不需要「全程铺底的环境床」（整局一直在、不随场景切）

这三条都不阻塞阶段 0。

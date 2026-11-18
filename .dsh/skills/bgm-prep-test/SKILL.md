---
name: bgm-prep-test
description: 配乐插件的端到端测试：每次新编 1 份 3 场景场景单，按正常流程建表、检索、听感标注，直到工作台里能看到带得分和标签的候选；输出每首歌每一步的耗时，供人工审核。也可用于实际环境验收。
whenToUse: 用户说「跑一次配乐测试」「三场景测试」「验证配乐工作台」「测一下选歌/标注耗时」时使用。不用于真实模组配乐，也不做定选和建歌单。
---

# 配乐 3 场景测试（bgm-prep-test）

这是一份**测试流程**，不是真实备团流程：

- 输入：不读模组，**每次现场新编**一份 3 场景的场景单；
- 跑法：`bgm_init` → 逐段 `bgm_fetch` → 逐段 `bgm_tag`，直到工作台能看到**带得分与标签概率**的候选；
- 输出：场景单 + 每首歌「检索 / 标注」两步的耗时 + 最终工作台指引；
- 停在哪：**候选标注完成就停**。不做 `bgm_pick`、不做 `bgm_commit`、不导出正式歌单。

> 真实的备团配乐流程见 `bgm-prep` skill。本 skill 只负责可重复的端到端测试。

---

## 0. 硬规则

1. **每次调用都必须新编场景单**。不要复制上次的 `cues.json`，不要用真实模组名；先看一眼 `test-runs/` 里最近的 slug，题材不要重复。
2. **固定 3 段，3 段都要 `need_bgm: true`**，且每段都要有候选、都要被标注。不能只做一段。
3. **不要中途停下来问「这样切对不对」**。这是测试；一次跑完，最后一起给结果。
4. **不要定选、不要建歌单**。看到候选带得分就停。
5. **计时必须用 `bin/timing.mjs` 从会话日志读**，不要凭感觉估，也不要把「工具返回的 0.0s」当成真实耗时。
6. **不改 `settings.json`**，不碰 cookie / credentials，不把任何凭据写进报告。
7. 测试产物留在 `test-runs/<runId>-<slug>/`，方便人工复核；不要删旧 run。

---

## 1. 准备

需要这些工具（由 `dsh-bgm-prep` 插件提供）：

- `bgm_init`
- `bgm_fetch`
- `bgm_tag`
- `bgm_view`

计时脚本（在本工作区根目录运行）：

```powershell
node ".dsh/skills/bgm-prep-test/bin/timing.mjs" --file "<cues.json>"
```

它会读当前会话的事件日志（`$DSH_SESSION_ID`）和 `cues.json` 里的 `analysis.at`，生成同目录的 `timing.md` / `timing.json`，并把 Markdown 打到 stdout。

工作台：侧边栏「配乐工作台」。它会默认打开最近一次成功执行的曲目表。

---

## 2. 新编场景单

### 2.1 先造一个本次专用的目录

用当前本地时间做 runId：

```powershell
Get-Date -Format 'yyyyMMdd-HHmmss'
```

然后：

```
test-runs/<runId>-<slug>/<slug>.cues.json
```

- `<slug>` 用英文小写短横线，例如 `tide-station`、`snow-inn`、`orbital-elevator`；
- 目录名带 runId，重复跑不会覆盖；
- `bgm_init` 会自动创建父目录。

### 2.2 题材：从下面的池子里挑一个，避开最近用过的

深海科考站、昭和温泉旅馆、太空电梯中段、边境邮局、废弃剧院、民国药铺、
高原天文台、港口冷库、雨林温室、老式电影院、海雾灯塔、地下防空洞。

三段按「进入 → 升级/对峙/揭示 → 爆发/收束/余波」组织，每段一个具体地点 + 一个正在发生的事件。

### 2.3 每段的目标听感（target）

`target` 只能填 music2emo 的原生英文标签，3–4 个，权重正数即可（会自动归一化）。
从下面的组合里挑 **3 种不同类型**，分别给 3 段，测试排序才有区分度：

| 类型 | target（权重） | 建议 tags |
|---|---|---|
| 压迫对峙 | dark .40 / dramatic .25 / heavy .20 / powerful .15 | tension 7，dark，driving，strings+percussion |
| 神秘探索 | dark .30 / meditative .25 / soundscape .25 / space .20 | tension 4，dark，static，drone+synth |
| 悲伤告别 | sad .35 / melancholic .25 / emotional .20 / soft .20 | tension 3，dark，static，piano+strings |
| 追击动作 | action .30 / energetic .25 / fast .20 / powerful .25 | tension 8，neutral，driving，percussion+synth |
| 史诗揭示 | epic .35 / dramatic .25 / inspiring .20 / powerful .20 | tension 7，neutral，building，strings+choir |
| 温暖重逢 | hopeful .30 / soft .25 / love .20 / romantic .25 | tension 3，bright，static，piano+strings |
| 荒诞日常 | funny .30 / fun .25 / groovy .20 / upbeat .25 | tension 3，bright，groovy，folk+percussion |
| 仪式灵性 | meditative .30 / soundscape .25 / dark .20 / epic .25 | tension 5，dark，building，choir+drone |
| 疲惫余波 | calm .30 / slow .25 / melancholic .25 / sad .20 | tension 2，neutral，static，piano+drone |
| 冰冷科幻 | space .30 / soundscape .25 / deep .20 / meditative .25 | tension 4，neutral，static，synth+drone |

合法标签（56 个，别自造）：

```
action adventure advertising background ballad calm children christmas commercial
cool corporate dark deep documentary drama dramatic dream emotional energetic epic
fast film fun funny game groovy happy heavy holiday hopeful inspiring love
meditative melancholic melodic motivational movie nature party positive powerful
relaxing retro romantic sad sexy slow soft soundscape space sport summer trailer
travel upbeat uplifting
```

注意：**没有** `tense`、`mysterious`、`horror`、`scary`、`warm`。要表达这些感觉，用组合（例如「紧张」= `dark` + `dramatic` + `heavy`）。

### 2.4 每段的其余字段

- `scene`：`地点 · 事件`，要具体，会印在表和工作台上；
- `trigger`：一句话，玩家看到/听到什么；
- `tags`：`tension` 0–10、`valence`、`energy`、`texture`（`drone/strings/piano/percussion/synth/choir/folk`）、`vocal`、`min_len`；
- `wants`：2–3 个**短**中文检索词（例如 `["低频 氛围","海底 压迫"]`）。**不要把场景名放进去**，会搜到流行歌；
- `avoids`：1–2 个负向描述（例如 `["人声","欢快"]`；能落到标签的会转成 `avoidTargets`，落不到的走标题关键词或标「无法验证」）；
- `vocal`：`none` / `wordless` / `any`；
- `need_bgm: true`。

### 2.5 一份可以直接照抄的 `bgm_init` 形状

```json
{
  "file": "test-runs/20261118-081530-tide-station/tide-station.cues.json",
  "module": "潮汐站 · 3 场景测试",
  "session": 1,
  "scope": "test-tide-station",
  "directives": [
    { "text": "全程避免可辨人声", "effect": { "vocal": "none" } }
  ],
  "cues": [
    {
      "id": "s1",
      "scene": "潮汐站 · 断电的观测层",
      "trigger": "玩家推开舱门，应急灯一盏盏亮起，海面在窗外压得很低",
      "target": [
        { "tag": "dark", "weight": 0.30 },
        { "tag": "meditative", "weight": 0.25 },
        { "tag": "soundscape", "weight": 0.25 },
        { "tag": "space", "weight": 0.20 }
      ],
      "tags": { "tension": 4, "valence": "dark", "energy": "static", "texture": ["drone", "synth"], "vocal": "none", "min_len": 240 },
      "wants": ["低频 氛围", "海底 压迫"],
      "avoids": ["人声", "欢快"],
      "vocal": "none",
      "need_bgm": true
    },
    {
      "id": "s2",
      "scene": "潮汐站 · 气闸外的敲击声",
      "trigger": "气闸外传来三下敲击，监控里却没有第二个人的热源",
      "target": [
        { "tag": "dark", "weight": 0.40 },
        { "tag": "dramatic", "weight": 0.25 },
        { "tag": "heavy", "weight": 0.20 },
        { "tag": "powerful", "weight": 0.15 }
      ],
      "tags": { "tension": 7, "valence": "dark", "energy": "driving", "texture": ["strings", "percussion"], "vocal": "none", "min_len": 180 },
      "wants": ["压迫 弦乐", "紧张 推进"],
      "avoids": ["人声", "旋律太甜"],
      "vocal": "none",
      "need_bgm": true
    },
    {
      "id": "s3",
      "scene": "潮汐站 · 最后一段日志",
      "trigger": "录音笔里传来自己的声音，读的却是明天的值班表",
      "target": [
        { "tag": "sad", "weight": 0.35 },
        { "tag": "melancholic", "weight": 0.25 },
        { "tag": "emotional", "weight": 0.20 },
        { "tag": "soft", "weight": 0.20 }
      ],
      "tags": { "tension": 3, "valence": "dark", "energy": "static", "texture": ["piano", "strings"], "vocal": "none", "min_len": 240 },
      "wants": ["钢琴 悲伤", "缓慢 氛围"],
      "avoids": ["人声", "欢快"],
      "vocal": "none",
      "need_bgm": true
    }
  ]
}
```

---

## 3. 建表：`bgm_init`

用 2.5 的形状调用。注意：

- `file` 用相对路径即可（工具按会话 cwd 解析）；
- `mode` 默认 `create`；runId 每次都新，不需要 `replace`；
- 返回后检查 `unmatched` 和 `dropped`：
  - 有 `dropped`：说明 target 里写了词表外的标签，用 `bgm_init({ mode: "patch", ... })` 改正后再继续；
  - 有 `unmatched`：显式 target 正常不会出现；出现就补 target。
- 把返回的 3 段场景表留在上下文里，最后交付要贴。

---

## 4. 逐段检索：`bgm_fetch`

对 `s1`、`s2`、`s3` **分别调用一次**：

```json
{ "file": "<cues.json>", "cue_ids": ["s1"] }
```

为什么逐段：一次检索的耗时是整段共用的，逐段调用后「第 1 段检索 12.3s」才能对得上该段候选；
如果三段一次搜完，只能得到「三段共用 30s」，没法按段报。这不是换流程，只是把同一次检索按段拆开。

- 第一段会顺带拉种子歌单，通常比后两段慢；报告里会体现，不用手记。
- 返回 `insufficient` 里有段：记下来，继续跑其余段；最后如实写「第 N 段候选不足」，**不要硬凑**。
- 不要在这时 `bgm_view`；计时脚本会自己读表。

---

## 5. 逐段标注：`bgm_tag`

对每段有候选的 cue 分别调用一次：

```json
{
  "file": "<cues.json>",
  "cue_ids": ["s1"],
  "per_cue": 8,
  "force": true
}
```

要点：

- **`force: true` 必须带**。否则 `analysis.db` 里已有结果的歌会被跳过，本次没有新的 `analysis.at`，那首歌就没有「本次标注耗时」。
- `per_cue: 8` 覆盖默认的整套候选；本测试要求工作台上**所有候选**都有得分。
- 每个 `bgm_tag` 调用的**第一首**会包含模型加载（约 5s）和首段下载，耗时明显偏大；报告里会标「批次首首（含模型加载）」，这是真实等待，不是异常。
- 如果返回 `partial: true` / `remaining > 0`：再调一次，**这次不要带 `force`**（只补没算的），最多补 2 次；还剩下就如实报告。
- 如果 `ok: false`（环境不完整、登录失效）：停在这里，把 `error` / `hint` 原样写进交付，**不要编造耗时**。

---

## 6. 复核：`bgm_view`

```json
{ "file": "<cues.json>", "scope": "full" }
```

它的表只显示段落和「待选（候选 N）」，**不展开每首候选**；不要用它判断「每首有没有 analysis」。
逐首是否标注完成，以计时脚本的汇总为准（它会统计 `analysis.probs` / `error` / 未分析）。

调用它就停：不要 `bgm_pick`，不要 `bgm_commit`。

---

## 7. 出计时报告

```powershell
node ".dsh/skills/bgm-prep-test/bin/timing.mjs" --file "<cues.json>"
```

把 stdout 的 Markdown **完整贴进交付**（它是本次的真正计时结果，不要自己另算一份）。

报告包含：

1. **步骤耗时表**：`bgm_init` / 每段 `bgm_fetch` / 每段 `bgm_tag` / `bgm_view` 的工具耗时；
2. **每首歌的每步耗时**：每段的候选逐行列出「检索 / 标注 / 段内得分 / 备注」；
3. **口径**：工具耗时来自会话事件日志，单首标注耗时来自 `analysis.at` 相邻差值；
4. **就绪检查**：所有候选都有 `analysis.probs` 时标 ✅；有失败/未分析会逐首标出。

常见情况：

- 报告里某首写「缓存命中；本次未重算」：说明 `force` 没生效或那次调用没覆盖它；如实保留，不要补一个假时间。
- 报告里写「结果集中返回，未逐首拆分」：运行中的插件把整批结果一次性落库了，逐首耗时不可得；只报该段工具总耗时，不拆分。
- 脚本报「没有找到这份曲目表的 bgm_* 调用」：等 1–2 秒再跑一次；仍不行就用 `--log` 指定当前会话日志，或把 `$DSH_SESSION_ID` 和 `$DSH_HOME` 打出来排查。

---

## 8. 交付格式

按这个顺序，不要只给一句「跑完了」：

1. **一句话结论**：3 段 / 多少候选 / 多少首完成标注 / 全流程墙钟。
2. **本次新编的场景单**：3 段，每段 `场景名` + `目标标签` + `一句话 trigger`。
3. **计时报告**：第 7 步 stdout 的完整 Markdown。
4. **工作台指引**：
   - 侧边栏「配乐工作台」；
   - 默认会打开本次这份表；没自动打开就点顶部「历史」选 `<file>`；
   - 每段候选按段内得分排序，每行显示「得分 + 两个概率最高的标签」；
   - 让用户自己试听、定选——本测试不替他选。
5. **文件链接**：`<cues.json>`、`<timing.md>`。
6. **口径提醒**（一句话）：首首含模型加载；检索耗时同段共用；缓存/集中返回会明确标出。

---

## 9. 失败处理

| 现象 | 处理 |
|---|---|
| `bgm_init` 报文件已存在 | runId 重复了；换一个 `-2` 后缀，不要用 `replace` 覆盖 |
| `unmatched` / `dropped` | `bgm_init({ mode: "patch", ... })` 改正 target；必要时重跑该段 `bgm_tag` |
| `bgm_fetch` 有段候选不足 | 记录段 id，继续其余段；交付时写明「候选不足，未标注」 |
| `bgm_tag` 返回 `ok: false` | 停；把 `error`、`checks`、`hint` 原样交给用户；不编造耗时 |
| `bgm_tag` 多次 `partial` | 不带 `force` 补 1–2 次；仍剩就报告剩余首数和 `stopReason` |
| 计时脚本找不到调用 | 等 2 秒重跑一次；仍不行用 `--log` 指定日志；不要用估算代替 |
| 计时脚本报「结果集中返回」 | 该段只报工具总耗时；逐首标 `—`，不拆 |
| 工作台没显示本次表 | 确认文件路径；用工作台「历史」选它；不要新建第二份表 |

---

## 10. 收尾检查

- [ ] 本次场景单确实是**新编**的，不是复制的；
- [ ] 3 段都在，且都有候选（候选不足的已写明）；
- [ ] 每段候选都有 `analysis.probs`，或逐首写明失败原因；
- [ ] 工作台能打开本次 `<cues.json>`，候选行上有得分和标签；
- [ ] 计时报告已完整贴出，逐首耗时没有被编造；
- [ ] 没有调用 `bgm_pick` / `bgm_commit`；
- [ ] `test-runs/<runId>-<slug>/` 下保留了 `cues.json`、`timing.md`、`timing.json`。

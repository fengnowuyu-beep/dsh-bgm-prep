# 备团配乐台 · 完整设计方案（v4.3）

> 性质：**设计文档**。从零设计，不继承现有实现。
> **v4.3 变更**：取消「20 个中文词 → Jamendo 映射」，**场景直接使用 music2emo 的原生标签与权重**。
> 目标：备团时十分钟内把「每段戏配什么」定下来，并生成能直接放的网易云歌单。

---

## 0. 产品定义

**一句话**：把场景清单变成「场景 → 歌」的草稿表，你在完整播放器里听、改、定选，最后一键成歌单。

| 步 | 谁做 | 做什么 |
|---|---|---|
| 1 | 你 | 贴进 10–20 行场景描述 |
| 2 | 插件 | 每段给 8 首候选 |
| 3 | 插件 | 按「听感是否贴近这段戏」排序 |
| 4 | 你 | 完整播放器里听，定选或换一首 |
| 5 | 插件 | 按场景顺序生成歌单 + 对照表 |

**成功标准**：排序准 → 试听少。准是手段，少是结果。

---

## 1. 范围

**做**：场景清单 / 候选检索 / 听感分析 / 段内排序 / 完整播放器 / 定选与拒绝 / 生成歌单与对照表。

**不做**：读模组自动拆场景、现场播放、训练模型、人工标注、织体打分、自动决定选哪首。

---

## 2. 五条设计判断

1. **准确率是第一目标，试听数是它的读数。**
2. **词表就是模型的原生标签**：不做中文转写、不做二次映射；模型认识哪些词，场景就用哪些词。
3. **检索先于分析**：候选捞不全，排序再准也没用。
4. **机器排序、人定选。**
5. **只在段内排序**：跨段比分数没有产品意义。

---

## 3. 流程

```
新建（模块 / 第几回 / 作用域）
   ↓ 粘贴场景清单
成表：一行一段 → 每段自动给 3–6 个听感标签 + 权重
   ↓ 「找候选」
每段 8 首（歌单搜索 6 + 歌曲搜索 2）
   ↓ 「分析听感」（music2emo，后台批量）
每段候选按加权得分排序，显示每个标签的概率与总分
   ↓ 完整播放器试听
定选 / 换一首 / 这段不配乐
   ↓ 「生成歌单」
网易云歌单 + 对照表
```

---

## 4. 数据模型

### 4.1 曲目表

```jsonc
{
  "version": 1, "module": "黑水溪", "session": 2, "scope": "s2",
  "cues": [{
    "id": "c01",
    "scene": "密斯卡托尼克山口 · 大地的心跳",
    "target": [
      { "tag": "dark",   "weight": 0.40 },
      { "tag": "dramatic", "weight": 0.25 },
      { "tag": "heavy",  "weight": 0.20 },
      { "tag": "calm",   "weight": 0.15 }
    ],
    "vocal": "none",
    "need": true,
    "candidates": [{
      "song_id": 785793, "title": "…", "artist": "…", "duration": 214,
      "source": "歌单「恐怖 纯音乐」",
      "analysis": {
        "probs": { "dark": 0.72, "dramatic": 0.58, "calm": 0.41, "happy": 0.02 }, // 模型原生 56 维
        "va": { "valence": 2.1, "arousal": 5.8 },
        "vocal": 0.42, "stability": 0.11,
        "engine": "music2emo|v1", "at": "…"
      }
    }],
    "pick": { "song_id": 785793, "title": "…" },
    "rejected": []
  }]
}
```

### 4.2 词表 `moods.json`：从模型里抄出来，冻结

安装验证时读 `inference/data/tag_list.npy`，把这份标签清单抄成 `moods.json`（带版本号），UI 与打分都只认这份。

- **实测：模型只有 56 个标签**（`tag_list.npy` 共 183 条，取 `[127:]` 得 56 条 mood/theme）。
- 标签是 Jamendo mood/theme 的原生英文词：`dark` `dramatic` `calm` `epic` `sad` `space` `groovy` ……
- **不做中文转写、不做二次映射**：屏幕上的词就是模型认识的词。

---

## 5. 场景 → 目标标签 + 权重

这是「机器理解场景」的唯一一步。原则：**结果一行看得完、一点就能改。**

### 5.1 每段 3–6 个标签，权重和为 1

```jsonc
"target": [
  { "tag": "dramatic", "weight": 0.40 },
  { "tag": "dark",     "weight": 0.30 },
  { "tag": "heavy",    "weight": 0.20 },
  { "tag": "calm",     "weight": 0.10 }
]
```

- 标签来自 §4.2 的冻结清单，**不新增、不改名**。
- 权重默认梯度（0.4/0.3/0.2/0.1），按场景可调。
- **权重直接显示**：`dramatic 0.40 · dark 0.30 · heavy 0.20 · calm 0.10`。

### 5.2 自动预填怎么来

场景是中文，标签是英文——这一步由「选词」完成，不做翻译：

| 中文场景线索 | 建议标签（示例） |
|---|---|
| 墓地、尸骸、怪物登场 | `dark` + `dramatic` + `heavy` |
| 对峙前、倒计时、追兵将至 | `dramatic` + `heavy` + `fast` |
| 营地、篝火、同伴闲谈 | `soft` + `hopeful` + `love` |
| 废墟、空城、回音 | `calm` + `space` + `meditative` |
| 集市、酒馆、庆典 | `happy` + `upbeat` + `groovy` |
| 星空、深渊、梦境 | `space` + `dream` + `meditative` |

- 规则命中 + agent 补全，预填 3–6 个；
- 「紧张」「温馨」这类中文感受**不作为一个标签存在**，而是被落成 `dramatic/dark/heavy` 或 `soft/mellow/hopeful` 的组合——这正是「词表是坐标系」：场景落在坐标里的某个位置，不必有同名坐标轴。

### 5.3 人工改

每段一行 chip：点一下取消/更换，权重可调。改完即冻结，不随重新检索漂移。

---

## 6. 检索

### 6.1 两个单元

| 单元 | 用途 |
|---|---|
| **歌单搜索**（主） | 按氛围召回；歌单名/描述本身就是人工听感标注 |
| **歌曲搜索**（辅） | 补风格、器乐、具体曲名 |

> 实测：`search song "恐怖 纯音乐"` 命中的是标题带「恐怖/鬼」的曲子，不是按听感检索。氛围召回主要靠歌单。

### 6.2 关键词怎么拼

中文检索词与英文标签不是一回事：**检索仍用中文情绪词**（网易云的曲库是中文生态），由目标标签反推一个中文检索词（如 `dark` → 「恐怖」，`dramatic` → 「紧张」），再拼 `纯音乐` / `BGM` / `跑团`。

### 6.3 收集与过滤

歌单每词 2 个（曲目 ≥10），每单 60 首；歌曲每词 30 首。
过滤：时长 <60 s 或 >10 min；标题含 `live|cover|翻唱|伴奏|remix|DJ`；本段 rejected；全表已用。
去重后取 8 首，不足 5 首放宽条件补一轮。

---

## 7. 描述层：music2emo

### 7.1 为什么是它

| 维度 | music2emo | CLAP |
|---|---|---|
| 表征 | MERT（音乐自监督） | 音频-文本对比 |
| 监督 | **有人类情绪标注**（Jamendo / DEAM / PMEmo / EmoMusic） | 无情绪标签 |
| 输出 | 56 个 Jamendo 情绪概率 + V/A（1–9） | 余弦，随 prompt 漂移 |
| 可比性 | 概率，跨曲可比 | 不可比 |
| 成绩 | Jamendo PR-AUC **0.1543**（胜过 MediaEval 2021 冠军 0.1508） | 多句词表下「轻快」0.02→0.83 |

**取舍**：music2emo 有情绪监督信号，CLAP 只有文本对齐；所以前者做主干。
CLAP 只在需要模型词表之外的标签时补位（当前不需要，保留开关）。

### 7.2 安装（全部落 E 盘）

> 独立 venv，不碰现有的 `E:\Software\audioml`（CLAP 环境，torch 2.14 / transformers 5.20，与 music2emo 的 pins 冲突）。
> E 盘现有 139.5 GB 空闲。

| 项 | 路径 |
|---|---|
| 环境（venv） | `E:\Software\audioml-m2e` |
| 代码 | `E:\Software\audioml-m2e\music2emo` |
| 模型 | `E:\Software\audioml-m2e\models`（`HF_HOME`） |
| pip 缓存 | `E:\Software\audioml-m2e\pip-cache` |

```powershell
# 0) 代理（本机 pip 会读到系统代理 127.0.0.1:7897，但缺 scheme 会报错，显式给上）
$env:HTTP_PROXY = 'http://127.0.0.1:7897'; $env:HTTPS_PROXY = 'http://127.0.0.1:7897'

# 1) 建 venv（本机 Python 3.10，与 music2emo 要求一致）
E:\Software\Python310\python.exe -m venv E:\Software\audioml-m2e
$env:PIP_CACHE_DIR = 'E:\Software\audioml-m2e\pip-cache'
E:\Software\audioml-m2e\Scripts\python -m pip install -U pip wheel

# 2) 先装 CPU 版 torch（避免被 requirements 拉成 CUDA 版）
E:\Software\audioml-m2e\Scripts\pip install torch==2.3.1 torchaudio==2.3.1 `
  --index-url https://download.pytorch.org/whl/cpu

# 3) 代码与权重（先下代码，requirements 在代码目录里）
$env:HF_HOME = 'E:\Software\audioml-m2e\models'
huggingface-cli download amaai-lab/music2emo --local-dir E:\Software\audioml-m2e\music2emo
huggingface-cli download m-a-p/MERT-v1-95M --local-dir E:\Software\audioml-m2e\models\MERT-v1-95M

# 4) 依赖：上游 requirements 有重复 PyYAML、numpy 钉在 2.x（与 torch 2.3.1 冲突），
#    用清理版；另补上游漏写的 mir_eval / pretty_midi
E:\Software\audioml-m2e\Scripts\pip install -r E:\Software\audioml-m2e\requirements.clean.txt
E:\Software\audioml-m2e\Scripts\pip install mir_eval pretty_midi
```

体积：MERT 约 360 MB；四个头各 12.4 MB；环境约 2–3 GB，全在 E 盘。

**已验证**：`chordparser` / `pretty_midi` / `mir_eval` / `music21` / `pytorch_lightning` / `torchmetrics` 都有 `py3-none-any` wheel；`torch==2.3.1` 有 cp310 Windows CPU wheel；和弦模型权重随仓库提供。

**真正的风险是研究代码的胶水**：`music2emo.py` 顶层 import gradio、推理链靠 hydra 配置。对策：不调门面类，写薄封装，只做「BTC 和弦 → MERT → `J_all` 头 → 概率 + V/A」。

**实测补丁（三处，已写入 E 盘的上游代码）**：

| 位置 | 改动 | 原因 |
|---|---|---|
| `music2emo.py` import 段 | `import gradio` 改成 try/except | 插件不需要 UI，也不装 gradio |
| `Music2emo.__init__` | MERT 路径改为读 `MERT_MODEL` 环境变量 | 权重在本地目录，不走 HF 缓存 |
| `predict` 里的 `torch.load(btc_model)` | 加 `map_location=self.device` | 该 checkpoint 存于 CUDA，CPU 机器加载会炸 |
| `predict` 的返回 dict | 多带 `probs`（56 维） | 原生只返回过阈值的 top 列表，无法算加权得分 |

**运行期兼容垫片（不改上游文件）**：`predict` 在 `music2emo.py:424` 先 `chordRootDic[chord]`
再判断 N/X，而 `chord_root.json` 只有 N + 12 个根音；BTC 词表里 X（index 168）是合法类别，
未知和弦段会抛 `KeyError: 'X'`。`tools/m2e/analyze.py` 在 import 后把模块的 `json` 换成只拦
`chord_root.json` 的代理，在内存补 `"X": 0`（N 的 ID）。不写盘；上游修好后垫片自动无害。
这也是“审计发现的上游 bug 不通过改上游源码解决”的示范：补丁留在插件侧，升级上游时不用重新打。

**实测耗时（CPU，i7 级，单曲 3 分半）**：模型加载 5 s + 解码 7 s + 推理 25 s。批量时加载只付一次。

**首跑还会遇到的坑**：`requirements.txt` 漏了 `mir_eval`、`pretty_midi`，且重复列了 `PyYAML` 两个版本导致 pip 解析失败——用 `requirements.clean.txt` 装（已修）。

### 7.3 接入步骤（每步有出口）

| 步 | 动作 | 出口 |
|---|---|---|
| 1 | 按 §7.2 装环境 | `python -c "import torch; print(torch.__version__)"` → 2.3.1 |
| 2 | 读 `tag_list.npy`，确认标签清单 | 得到确切的词表，抄进 `moods.json` |
| 3 | 跑通仓库自带单曲推理 | 打印出 valence/arousal 与情绪标签 |
| 4 | 写薄封装 `tools/m2e/analyze.py`，输出完整概率向量 | 一条命令出 JSON |
| 5 | 与插件对接 | 表里候选有 `analysis.probs` |

**第 3 步过不去就停**：胶水成本过高，退回 CLAP（接口不变，只换引擎）。

### 7.4 分析流程

```
song_id → 直链 → 下载（≤4 min, 24 kHz）
        → 切 30 秒段（最多 8 段，跳首尾 3 秒）
        → BTC 和弦 + MERT 特征 → J_all 头 → 各标签概率
                              → D_all 头 → valence/arousal
        → 多段取平均；stability = 段间极差
        → 缓存
```

- 按歌缓存：`cache/analysis/<song_id>-<m2eVer>.json`。
- 拿不到直链 → `analysis: null`，排序垫底。
- 单曲 CPU 耗时：每 30 秒段数秒，整曲十几秒量级（**未实测**，第 3 步记录）。

---

## 8. 排序与展示

### 8.1 打分

```
得分 = Σ w_t · p_t(song) / Σ w_t
```

- `w_t`：这段给的标签权重；`p_t`：模型对该标签的概率。
- **没有二次映射**：权重直接乘在模型输出上。
- 人声：`vocal: none` 且 `vocal > 0.5` → ×0.85。
- 稳定度：高则标「情绪不稳」，不扣分。

### 8.2 段内排序

已定选曲不重复当别段首选；不做跨段分数比较。

### 8.3 展示：两层信息

```
★ 1  《曲名》· 艺人 · 3:34        ▶
      得分 0.61
      dark 0.72 · dramatic 0.58 · calm 0.41
```

- **每个标签的概率**：看得出为什么排第一。
- **加权总分**：按本段权重算出，换段或改权重会变，标「段内得分」。

---

## 9. 工作台

```
┌──────────────────────────────────────────────────────────────┐
│ 黑水溪 · 第 2 回   进度 7/13   [找候选] [分析听感] [生成歌单] │
├───────────────┬──────────────────────────────────────────────┤
│ 场景列表       │ 候选表（当前段）                              │
│ ● c01 进山的…  │ ★ 1  曲名 · 艺人 · 3:34   ▶   得分 0.61      │
│   dark .4 …    │      dark 0.72 · dramatic 0.58                │
│ ○ c02 …        │   2  曲名 · 艺人 · 2:58   ▶   得分 0.54      │
├───────────────┴──────────────────────────────────────────────┤
│ ▶ ──────●────────── 1:12 / 3:34   🔊  ⏮ ⏭                  │
└──────────────────────────────────────────────────────────────┘
```

- 完整播放器：播放/暂停、拖进度、上下首、音量。
- 单击播放、双击定选；`空格` 播放暂停、`↑/↓` 选行、`Enter` 定选、`R` 拒绝。

---

## 10. 产出

1. 网易云歌单（按场景顺序，幂等）。
2. `review.md` / `review.csv`：场景、定选曲、标签与权重、标签概率。
3. 歌单 ID 写回曲目表。

---

## 11. 工具面

| 工具 | 作用 |
|---|---|
| `bgm_create` | 建表 / 追加 / 改 |
| `bgm_fetch` | 找候选 |
| `bgm_analyze` | 分析听感（调 m2e 封装） |
| `bgm_pick` | 定选 |
| `bgm_playlist` | 生成歌单 |
| `bgm_view` | 只读 |

原则：一工具一职责；参数收敛到 `file` + 少量可选；写操作原子化并备份；只读无副作用。

---

## 12. 配置

```jsonc
{
  "analysis": {
    "engine": "music2emo",
    "python": "E:\\Software\\audioml-m2e\\Scripts\\python.exe",
    "code":   "E:\\Software\\audioml-m2e\\music2emo",
    "models": "E:\\Software\\audioml-m2e\\models",
    "script": "<插件目录>\\tools\\m2e\\analyze.py"
  }
}
```

---

## 13. 缓存与存储

```
$DSH_HOME/bgm-prep/
  settings.json / moods.json   # moods.json 是 tag_list.npy 的冻结副本
  projects/<slug>/<scope>.cues.json
  cache/analysis/<song_id>-<m2eVer>.json
  cache/url/<song_id>.json
```

---

## 14. 失败与降级

| 情况 | 行为 |
|---|---|
| 未登录 | 顶栏扫码；检索不可用，其余可用 |
| 歌单搜不到 | 只走歌曲搜索 |
| m2e 环境缺失 | 降级 CLAP；两者都缺则只提供检索/试听/成单 |
| m2e 单曲失败 | 标失败，下次只补失败项 |
| 拿不到音频 | 标「无法分析」，排序垫底 |
| 建歌单失败 | 保留对照表 + 原因 |

---

## 15. 评测

### 15.1 准确性（主指标）

7 首已知气质曲，期望标签与禁忌标签用**模型原生词**写：

| # | 曲目 | 期望（原生标签） | 禁忌 |
|---|---|---|---|
| 1 | 轻快日式民谣 | `happy` `upbeat` | `dark` `heavy` |
| 2 | 有节奏的说唱 | `groovy` `energetic` | `soft` `calm` |
| 3 | 安静钢琴 | `calm` `sad` | `heavy` `energetic` |
| 4 | 恐怖氛围 | `dark` `dramatic` `heavy` | `happy` `upbeat` |
| 5 | 暗黑 drone | `dark` `meditative` | `happy` |
| 6 | 史诗管弦 | `epic` `powerful` | — |
| 7 | 对照（第 1 首间奏） | 与整曲应明显不同 | — |

**Top-1 ≥ 6/7 且禁忌 = 0** 才发布排序功能。

### 15.2 产品指标

| 指标 | 目标 |
|---|---|
| 首选接受率 | ≥40% |
| 前三命中率 | ≥80% |
| 试听数（段→定选） | 中位 ≤3 |

### 15.3 纪律

不拿历史选曲当金标；不为了指标好看调阈值；指标出来前不宣称「准」。

---

## 16. 里程碑

| 阶段 | 内容 | 出口 |
|---|---|---|
| **M1** | 表 + 检索 + 完整播放器 + 定选 + 歌单 | 无分析也能用 |
| **M2** | 装 music2emo + 读词表 + 单曲跑通 + 薄封装 | 输出完整概率向量 |
| **M2b** | 场景→标签预填 + 排序 + 缓存 | 候选按听感排序 |
| **M3** | 权重可改 + 依据展示 | 建表后少改几下 |
| **M4** | 7 首验收 + 产品指标 | 决定是否保留 CLAP 补位 |

---

## 17. 风险

| 风险 | 对策 |
|---|---|
| 研究代码胶水（gradio/hydra/路径） | 薄封装；第 3 步过不去退回 CLAP |
| 和弦链（BTC）在 Windows 上的行为 | 权重自带；跑测试曲验证 |
| 中文/日系曲目分布外 | 7 首里放 2 首中文、1 首日系 |
| PR-AUC 0.154 绝对值不可信 | 只用于排序，不宣称准确率 |
| 标签清单与预期不符（56 vs 59） | 以 `tag_list.npy` 为准，写进 `moods.json` 并记录版本 |
| CPU 耗时 | 缓存 + 后台批量 |
| MERT 权重 CC BY-NC | 非商用；开源不打包权重 |
| E 盘空间 | 约 3 GB，当前 139.5 GB 足够 |

---

## 18. 一句话

**场景直接说模型的话，模型直接给概率。** 词表不翻译、不映射：`dark`、`dramatic`、`calm` 既是模型认识的字，也是你写在场景表上的字。

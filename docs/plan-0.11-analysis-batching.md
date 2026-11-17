# 听感分析：分批 + 增量落库（0.11 修改方案）

> 性质：**修改方案，未实施**。等确认后再动代码。
> 触发：2026-11-18 06:13–06:34 一次真实跑批，20 分钟全损，一首没落库。
> 结论：**不是环境坏了，是插件把「长任务」当成了「一次同步调用」。**

---

## 0. 一句话

把「一次调用跑完一整批、跑完才落库」改成「**每算完一首就落库 + 工具自己去分批**」，让任何中断最多损失一首。

---

## 1. 现场事实

### 1.1 时间线

| 时刻 | 事件 |
|---|---|
| 06:13:55 | `bgm_tag` 开始，8 段（c01–c05、c07–c09），去重 **56 首** |
| 06:14–06:32 | `analyze.py` 顺序处理，temp 目录逐首落 wav，到 6:32:53 完成 **13 首**（下载+解码） |
| 06:33:56 | 命中 `timeoutMs = 1200000`，子进程被杀 |
| 06:33:56 | 工具返回「❌ 分析超时（1200s）」 |
| 06:34 | 查 `analysis.db`：**仍是 1 行**（6:07 的旧记录）→ 13 首成果全部作废 |

### 1.2 引擎是健康的

`_selftest.log`（6:34:46）：

```
model loaded in 4.7s
decoded (4915408,) in 6.1s
predicted in 23.0s        # 56 维 probs 正常
```

单首纯推理 ≈ **34 s**。而批量跑批时实测 ≈ **95 s/首**——当时推断差出来的 60 s 是**下载**（每首 10–44 MB 完整音频，不是预览）。

> **更正（2026-11-18 06:45–06:54 复测）**：上面的推断不成立，慢的是**推理**，不是下载。
>
> | 调用 | 首数 | 耗时 | 每首 |
> |---|---|---|---|
> | s1 | 8 | ≈120 s | ~15 s |
> | s2 | 7（命中缓存 1） | 164 s | 23 s |
> | s3 | 7 | 216 s | 31 s |
>
> 平均 23 s/首，与 selftest 的「本地文件、零下载 → predict 23.0 s」基本相等，**下载只占几秒**。
> 按 8 首一批实测，22 首共 8.5 分钟；56 首约 22–25 分钟，仍会撞 20 分钟线——撞线原因不变，但主导项是计算：
> `torch 2.3.1+cpu`（**无 CUDA 构建**，本机 RTX 3060 Ti 8 GB 空转），`get_num_threads()=10`（16 核未用满），
> 且 `feature_extractor_cqt requires 'nnAudio'` 未装 → CQT 走 CPU 慢路径。详见 §3.5。

### 1.3 算术

```
旧估值：56 首 × 95 s ≈ 90 min
复测值：56 首 × 23 s ≈ 21 min      # 2026-11-18 06:45 实测
timeoutMs  = 20 min
```

**旧估值 4.5 倍超线；复测值仍然擦线略超**——所以「一次 56 首」在两种口径下都跑不完。区别在于：

- 超线的原因从「下载慢」变成「CPU 推理慢」（见 §1.2 更正、§3.5）；
- 这也意味着**只要把推理搬到 GPU（F7），56 首就落到 2–3 分钟**，20 分钟线不再是主要矛盾；
- 但超时机制本身仍然必须改（F1/F2/F3）——它防的是单首卡死，而不是总量。

---

## 2. 根因（四处，按严重度）

### R1 全有或全无（最致命）

- `tools/m2e/analyze.py:82-101`：顺序处理，结果只进内存 `results`，**结尾 `json.dump` 一次**（`:103`）。
- `lib/analyze.js:176-192`：要等子进程 `close` 之后才循环 `writeAnalysis()`。

→ 进程被杀 = **一首都留不下**。

补充证据：`~/.dsh/bgm-prep/cache/analysis/` 里 8 个旧 JSON 的 `at` 全在**同一秒**（21:58:44.947–.949），说明旧版也是攒完写一次。**这个坑一直都在**，只是以前批量小（8 首 ≈ 2 分钟）没撞上 20 分钟线。

### R2 超时值与工作量脱钩

- `lib/analyze.js:21-29` 的 `DEFAULTS` 里 `timeoutMs: 1200000` 写死。
- 没有一处按「首数 × 单首耗时」估算；`bgm_tag` 也完全不限制 `tracks.length`（`lib/index.js:868-879`）。
- 计时器是**整个调用共用一个**，不是每首。
- 同款问题在 `lib/tag.js:26`（`timeoutMs: 600000`）也有，属于同一个设计习惯。

### R3 一次要太多，且不告知剩余

- `lib/index.js:865` 取**所有**有候选的段，`per_cue` 默认 8 → 一个调用吞 56 首。
- 返回体（`lib/index.js:831-846`）没有 `remaining` / `partial`，agent 无从判断「还剩多少、要不要再调一次」，只能一把梭。

### R4 音频不复用 + temp 泄漏

- `analyze.py:81` 用 `mkdtemp(prefix="m2e-")`，**从不清理**，每首 10–44 MB。
- 当前 `%TEMP%` 下四个 `m2e-*` 目录共 **1.19 GB**（547 + 304 + 304 + 36 MB）。
- 同一首歌重跑要重新下载——而下载就是主要成本（95 s 里占 60 s+）。

---

## 3. 修法

### F1 增量落库（核心，不做这个其它都白修）

把 `analyze.py` 的输出契约从**单个 JSON** 改成 **NDJSON（一行一首）**：

```jsonc
{"song_id": 27598102, "result": {"probs": {...}, "va": {...}, "stability": null}}
{"song_id": 1398802958, "result": {"error": "no playable url"}}
{"done": true, "count": 2}
```

- `analyze.py` 每首算完立即 `print(json.dumps(line), flush=True)`，**不攒**。
- `lib/analyze.js` 按 `\n` 缓冲逐行解析，**每行立刻 `writeAnalysis()`**，同时填 `results`。
- 超时语义拆成两层：

| 配置 | 默认 | 作用 |
|---|---|---|
| `perSongTimeoutMs` | 180 s | 单首卡死只放弃这一首，记 `error` 继续下一首 |
| `totalBudgetMs` | ≤90 min（按首数推导，见 F3） | 到点**优雅收尾**：kill 子进程，**保留已落库部分**，返回 `partial: true` |

- `bgm_tag` 遇到 `partial` 照常 `applyAnalysis()` + `writeSheet()`，返回体带 `partial` 与 `remaining`。

### F2 工具自己分批，对 agent 透明

- `bgm_tag` 新增参数 `max_songs`（默认 **24**）。超过就只处理前 24 首，返回 `remaining`，agent 再调一次。
- 内部再按 `batchSize`（默认 **8**）切批，每批 spawn 一次 `analyze.py`：
  - 让单次超时的**损失上界**从 56 首降到 8 首；
  - MERT 多加载几次，每次 5 s，可接受。
- 兼容：不传 `max_songs` 也走默认 24，**不再出现「一个调用 56 首」**。

### F3 超时改成推导值，不再写死

```
totalBudgetMs = min(perSongTimeoutMs × n × 1.5, 90 min)     // n = 本次实际首数
```

- 两个值都进 `settings.json` 的 `analysis` 段，代码里只留默认；
- `README.md` 的「听感分析」段（约 165–205 行）补一小节说明。

### F4 音频缓存 + temp 清理

- 下载落 `$DSH_HOME/bgm-prep/cache/audio/<song_id>-<m2eVer>.wav`（24 kHz mono，≈12 MB/首），存在就跳过下载；
- 容量上限（默认 5 GB）LRU 淘汰；
- `analyze.py` 的 `tmp_dir` 用 `try/finally` 删除；失败时把目录路径打到 stderr 再保留。

### F5 下载与推理重叠（可选，收益最大）

- 下载是瓶颈。两种做法二选一：
  - **A** 把「取直链 + 下载」上移到 `lib/analyze.js`（Node `fetch`，并发 3），python 只做解码 + 推理；
  - **B** 留在 python 里，先并发下完一批再顺序推理。
- 预期：单首 ~95 s → ~40 s（≈ 推理 34 s + 摊薄后的下载）。

### F6 返回体与渲染

- `lib/index.js:831-846` 的 `output.schema` 增加 `partial` / `remaining` / `stopReason` / `batches`；
- `render` 增一行：`已分析 18 首 · 还剩 38 首（本次预算用完，再调一次继续）`。

---

## 3.5 环境级加速（F7–F9，前置项，不改一行插件代码）

> 性质：**只动 `E:\Software\audioml-m2e` 这个 venv 的环境**，不碰 `lib/`、`tools/`。
> 收益：把单首 ~23 s 压到 ~1–2 s，使「分批」从「必须」变成「冗余保险」。
> **但 F1（增量落库）仍然要做**——环境再快也挡不住单首卡死、网络抖动和 future 的长曲目。

### 现状（2026-11-18 实测）

| 项 | 值 |
|---|---|
| torch | `2.3.1+cpu` —— 纯 CPU wheel |
| GPU | RTX 3060 Ti 8 GB（`cuda False`，完全没被用上） |
| torch 线程 | `get_num_threads() = 10`（本机 16 核） |
| nnAudio | 未安装 → `WARNING: feature_extractor_cqt requires the library 'nnAudio'` |
| 单首耗时 | 下载几秒 + 解码 ~6 s + **推理 ~20 s** |

### F7 换 CUDA 版 torch（数量级优化）

- 目标：`torch==2.3.1+cu121`（与现版本同号，只换构建，避免和 `requirements.clean.txt` 里其它包版本冲突）。
- 安装：

  ```powershell
  & E:\Software\audioml-m2e\Scripts\python.exe -m pip install `
      --index-url https://download.pytorch.org/whl/cu121 `
      --force-reinstall torch==2.3.1+cu121
  ```

- 前置检查：驱动需支持 CUDA 12.1（`nvidia-smi` 右上角 `CUDA Version ≥ 12.1`）；不满足就先升驱动，**不要**退回 cu118 硬凑。
- 验证：

  ```powershell
  & E:\Software\audioml-m2e\Scripts\python.exe -c "import torch;print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
  ```

  期望输出 `2.3.1+cu121 True NVIDIA GeForce RTX 3060 Ti`，且跑一遍 `selftest.py`：
  `predicted in` 应从 **23.0 s** 掉到 **1–2 s**（MERT 特征 + 情绪头都在 GPU 上）。
- 回滚：`pip install --force-reinstall torch==2.3.1+cpu`（原 wheel 名记在这里，随时可退）。
- 注意：`music2emo.py` 里的 `device`/`.to(...)` 若写死 `cpu`，需在 venv 外用环境变量或改**副本**绕开——**不修改 `E:\Software\audioml-m2e\music2emo` 源码**，优先确认它是否自动选 device。
- 风险：显存 8 GB 对 MERT-v1-95M 足够（~1.5 GB 权重）；若 OOM，加 `PYTORCH_CUDA_ALLOC_CONF=max_split_size_mb:128`。

### F8 线程数用满（小修，+20–30%）

- 现状 10/16 核。两处都要设，缺一不生效：
  1. 启动子进程处（`lib/analyze.js` spawn `analyze.py` 时）注入 `env: { ...process.env, OMP_NUM_THREADS: '16', MKL_NUM_THREADS: '16' }`；
  2. `analyze.py` 在 `import torch` **之后**立刻 `torch.set_num_threads(int(os.environ.get('M2E_THREADS', '16')))`。
- 注意：**F7 上了 GPU 后这条基本失效**（推理不再吃 CPU 线程），只对纯 CPU 兜底路径有意义；两步都保留，配置项进 `settings.json` 的 `analysis` 段（`threads`，默认 16）。
- 不要把线程数设成 32 之类超过物理核的值——超订会因上下文切换变慢。

### F9 装 nnAudio（补 CQT 快路径）

- 动机：日志里 `feature_extractor_cqt requires the library 'nnAudio'`，说明和弦/调性特征走了 librosa 的 CPU CQT，是 20 s 里的一截。
- 安装：

  ```powershell
  & E:\Software\audioml-m2e\Scripts\python.exe -m pip install nnAudio
  ```

- 验证：重跑 `selftest.py`，`RequestsDependencyWarning` 之外的 **nnAudio 警告消失**；`predicted in` 时间无回升。
- 注意：nnAudio 依赖 torch，**必须装在 F7 之后**，否则会把它拉成对 CPU 版 torch 的依赖；装完复查 `torch.__version__` 是否被顺带改回 `+cpu`。
- 若 nnAudio 与现有 librosa/numpy 版本打架（安装时报依赖冲突），**放弃此项**——它只是边际优化，不值得为此降级 numpy。

### 验收（三项各自独立）

| 项 | 判据 |
|---|---|
| F7 | `torch.cuda.is_available()` 为 True；selftest `predict` ≤ 2 s；`bgm_tag` 8 首 ≤ 60 s |
| F8 | 纯 CPU 路径下 selftest `predict` 比 23.0 s 快 ≥20% |
| F9 | nnAudio 警告消失；`predict` 不回退；torch 版本仍是 `+cu121` |
| 总 | 56 首一次 `bgm_tag` 从 ~25 min 降到 **≤ 3 min**，20 分钟线不再是约束（但仍保留 F2 的 `max_songs` 作为保险） |

### 与 F1–F6 的关系

- **F7–F9 不能替代 F1**：GPU 快的是「正常路径」，单首网络卡死/解码失败照样会让整批到点被杀。增量落库是正确性问题，加速只是性能问题。
- **顺序**：F7 → F8 → F9 先做（半天内可完成、可回滚、零代码改动），再进 F1。这样 F1 的验收跑批本身只要几分钟，迭代快得多。
- 加速生效后，F3 的 `totalBudgetMs` 推导可以放松（例如 `perSongTimeoutMs × n × 1.2`），但默认值仍按 CPU 兜底算，避免在没 GPU 的机器上误判。

---

## 4. 契约变更与兼容

| 层 | 变更 | 兼容策略 |
|---|---|---|
| `analyze.py` stdout | 单 JSON → NDJSON | `analyze.js` 两种都认：认出 `done` 标记走 NDJSON，否则按整体 JSON 兜底 |
| `analysis.db` | schema 不变（`song_id + engine` 已够） | 无需迁移；`audioMs` 列可选，非必需 |
| 曲目表 `.cues.json` | 不变 | 无 |
| `bgm_tag` 入参 | 新增 `max_songs` | 可选参数，旧调用照常 |

---

## 5. 验收

| 项 | 判据 |
|---|---|
| **中断不白跑** | 跑到第 10 首时 `taskkill` python，`analysis.db` 应已有 9–10 行 |
| **重跑不重复** | 再调 `bgm_tag`，`tried` 只剩剩余首数；`cache/audio` 命中后不再下载 |
| **不撞超时** | 56 首分 3 次调用完成，单次都在预算内；任一次返回 `partial` 也能接着跑 |
| **磁盘不涨** | `%TEMP%` 下不再新增 `m2e-*` 残留；`cache/audio` 不超上限 |

回归：`npm test`（现 43 个用例），新增 —— NDJSON 解析、partial 保留、批次切分、音频缓存命中。

---

## 6. 实施顺序

0. **F7 → F8 → F9**（§3.5）环境加速 —— 半天内完成、零代码改动、可回滚。先做它，后面每一步的验证跑批都从几十分钟降到几分钟。
1. **F1** 增量落库 —— 不改它，其它都是白修。
2. **F3 + F2** 预算推导 + 分批 —— 让默认路径不再撞墙。
3. **F4** 音频缓存 + temp 清理 —— 降本，顺手清掉 1.19 GB。
4. **F6** 返回体 —— 让 agent 看得见「还剩多少」。
5. **F5** 并发下载 —— 最后做，风险最低收益最大；F7 生效后该项优先级下降（下载本就不是瓶颈）。

---

## 7. 不做什么

- 不换模型、不动打分与 UI。
- **不上 GPU 的原始约束已作废**（2026-11-18 修订）：改为「只换 torch 构建，不换模型、不改 `music2emo` 源码」——见 §3.5 F7。GPU 只服务本机分析，不改变任何对外行为。
- **不做「后台任务化」**：工具调用仍同步，增量落库 + 分批已经够。真要后台化是另一件事，等有实时进度条再说。
- 不为了让测试快点过而调低 `per_cue` 候选数——那会掩盖问题。

---

## 8. 附：排查中发现的环境问题（不属于本方案，但会影响验证）

**运行中的插件不是磁盘上的版本。** 证据：

| 时刻 | 事实 |
|---|---|
| 5:46 | DSH 启动 |
| 6:06–6:09 | `analysisDb.js` / `analyze.js` / `index.js` 改成 0.10.0（SQLite） |
| 6:38:43 | 一次 8 首的成功分析，结果写成 7 个 **`cache/analysis/*-music2emo-v1.json`**（旧的 JSON 缓存格式） |
| 6:38:43 | 同期 `analysis.db` **一行没涨**（仍是 6:07:22 的 1 行） |

→ 跑的是 **0.9.x 的旧代码**，0.10.0 的 SQLite 缓存路径**从未被执行**。DSH 没有热重载插件。

**影响**：在上面修 F1–F6 之前，要先重启 DSH（或重载插件），否则改了代码也不会生效，验证会得出错误结论。

**顺带发现的隐患**：`lib/analysisDb.js` 的 `openDb()` / `writeAnalysis()` 用 `catch { return null / false }` **静默吞掉所有异常**。一旦 SQLite 真的不可用或写入失败，表面一切正常、库里一条没有——这次就是"看起来在缓存，其实没有"。
建议至少改成 `logger.debug?.()` 记一行，并在 `bgm_tag` 的返回里区分「库不可用 → 退回 JSON 缓存」与「库正常但写入失败」。

---

## 附：证据在哪儿

| 内容 | 路径 |
|---|---|
| 那次会话的事件流（zstd） | `~/.dsh/sessions/--E-Data-Project-DeepSeekHarness-DSH-Homemade-Plugins-dsh-bgm-prep--/session-12e3ac1b-…/session.v4.jsonl.zstd` |
| 超时返回 | 该会话 seq 90：`❌ 分析超时（1200s）` |
| 引擎自检 | `~/.dsh/bgm-prep/_selftest.log` |
| 13 首已下载的 wav | `%TEMP%\m2e-1yfb9dk9\`（547.7 MB） |
| 分析库 | `~/.dsh/bgm-prep/analysis.db`（1 行） |

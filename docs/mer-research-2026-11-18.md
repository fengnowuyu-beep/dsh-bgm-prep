# 音乐情绪 / 风格识别方案调研（2026-11-18）

> 范围：`dsh-bgm-prep` 的「自动打标」环节，评估「有没有比 CLAP 零样本更准的、可本地部署的音乐情绪/风格识别方案」。
> 性质：**只读调研**。未改动任何代码，未安装依赖，未提交 git。
> 核实口径：文中每个结论都标了来源与核实状态（§7）。区分「本机实测」「联网核实」「未核实」「我的推断」四档。
> **补充（同日）**：放开「允许调用 API / 线上服务」约束后的调研与成本见 **§9**，它修正了 §4.B 的结论。

---

## 0. 一句话结论

**「换一个更准的模型」大概率救不了这个问题——先换打分方式，再考虑加一个绝对情绪轴。**

三条硬证据：

1. 专用 MER 模型在 MTG-Jamendo mood/theme 上的天花板只有 **PR-AUC 0.13–0.15**（MERT-95M 0.134、MediaEval'21 冠军 0.151、music2emo 0.154），这是「比随机好，但远不能当判决」的量级；换成有监督模型相对现在的 CLAP 也只提升十几个百分点，不是「判对」。
2. 已有实测（扩成 5 句 → 轻快 0.83 / 安静钢琴 0.16）证明：错的不是模型表征，是问法。
3. 读代码发现，「只听中段 30 秒」比描述更严重：所谓中段是**前 45 秒的中段**（`librosa.load(..., duration=45)` 之后再取中间 30 s），长曲实际只听了开头 1/10，正好落在前奏/主歌，是日式民谣被误判的合理嫌疑。

推荐组合：**A（重做 CLAP 用法：多窗 + 音频锚点 + 非零和打分）必做；B（music2emo 作绝对 V/A 轴）可选加装。** 见 §4。

---

## 1. 现场（本机实测）

| 项 | 值 | 核实方式 |
|---|---|---|
| Python | 3.10.0（`E:\Software\Python310\python.exe`） | `python -V` |
| 推理环境 | `E:\Software\audioml\.venv`：torch **2.14.1+cpu**、transformers **5.20.2**、librosa 0.11.0、numpy 2.2.6、scipy 1.15.3、**scikit-learn 1.7.2**、soundfile 0.14.0 | 读 dist-info |
| GPU | RTX 3060 Ti 8192 MiB，驱动 560.94；**torch 是 CPU 构建**（`torch.version.cuda=None`、`cuda.is_available()=False`） | torch 自检 |
| 未安装 | essentia、onnxruntime、tensorflow、torchaudio | 列 site-packages |
| transformers 5.20.2 音频模型 | 有 `clap`、`qwen2_audio`、`qwen2_5_omni`、`qwen3_omni_moe`、`audioflamingo3`、`musicgen`、`ast`；**没有 `mert`**（`import transformers.models.mert` → ModuleNotFoundError） | 目录 + 导入实测 |
| 磁盘 | E: 139 GB 可用 | `Get-PSDrive` |

### 1.1 两个代码层面的发现

**（a）CLAP 权重不在缓存里。**
`E:\Software\audioml\models\hub\models--laion--larger_clap_music_and_speech` 下只有约 **3 MB** 的 config / tokenizer 分片，没有 740 MB 的 `pytorch_model.bin`，`xet` 目录也是空的。若打标确实能跑通，权重应来自别处或每次现下。**换方案前应先确认这一点**，否则测到的基线可能不是以为的那份模型。

**（b）词表是跨曲 union 的，分数不可复现。**
`label_of` 把全局 12 条 + 所有曲目 prompts 合成并集（[analyze.py:101-108](../tools/tag/analyze.py)），每首曲子的 softmax 都在这个并集上做（[analyze.py:156](../tools/tag/analyze.py)）。结果是：**同一首歌，放进不同批次的候选池，分数会变**。这比「零和」更硬——不只是跨段不可比，是跨批次不可复现。

---

## 2. 诊断：四个已知缺陷的权重不一样

| 缺陷 | 性质 | 换模型能修吗 | 成本最低的修法 |
|---|---|---|---|
| 单句 prompt 太窄 | 文本侧 | 能，但不必 | prompt 集合 → 再加音频锚点（§4.A2 / A+） |
| 只听「前 45 s 的中段」 | 代码 bug 级 | 不需要 | 全曲分窗（§4.A1） |
| softmax 零和 + 跨批不可比 | 数学 | 不需要 | 去 softmax，改锚点余弦 + 自校准（§4.A2） |
| 词表硬编码 12 个 | 产品 | 不需要 | 词表进 `settings.json`（§4.A3） |

**换模型只能改善「表征」一项，而前两项是代码与数学问题。** 这是本报告最核心的判断，也是不建议直接上大模型的原因。

---

## 3. 候选方案核实

### 3.1 Essentia（DEAM / Jamendo 系）：Windows 仍然没有 pip wheel

直接查 PyPI 索引（非记忆）：

| 包 | 全部文件数 | 其中 Windows wheel |
|---|---|---|
| `essentia` | 226 | **0** |
| `essentia-tensorflow` | 79 | **0** |

最新版 `2.1b6.dev1438`（上传 **2026-05-19**）只发布：`macosx_15_0_arm64`、`macosx_15_0_x86_64`、`manylinux2014_x86_64`（cp314）。历史全量里也没有任何 `win_amd64`。

→ **结论：截至今天，Essentia 在 Windows 上依然装不了 pip wheel，只剩源码编译一条路（C++ + TF，MSVC 下是硬仗）。**

**许可证**（[Essentia licensing 页](https://essentia.upf.edu/licensing_information.html)、PyPI 元数据）：
- 库本体 **AGPL-3.0-only**，商用需另购；
- **所有预训练模型 CC BY-NC-SA 4.0** —— 含 `deam-msd-musicnn`、`msd-musicnn`、`discogs-effnet`、Jamendo mood/theme 头。NC = 非商用，SA = 衍生作品同协议。

**三条绕法（都不建议做主线）：**

1. **不用 Essentia，用 TensorFlow 直接加载 `.pb`**：`tensorflow-cpu` 有 cp310 `win_amd64` wheel（最新 2.22.0rc1；2.21.0 也有 cp310）。技术上可行，但要自己复刻 mel 前端（musicnn 前端为 16 kHz / 96 mel / 187 帧 patch ≈ 3 s，逐 patch 预测再平均）与输入输出节点名，**估计 1–3 天**，且模型仍是 NC-SA。
2. **社区 ONNX 移植**：存在 [`avari1250/discogs-maest-30s-pw-129e-onnx`](https://huggingface.co/avari1250/discogs-maest-30s-pw-129e-onnx)（347 MB，输入 `[1,1876,96]` log-mel@16k，输出 400 类）与 [`Heyian/discogs-effnet-onnx`](https://huggingface.co/Heyian/discogs-effnet-onnx)；`onnxruntime` 有 cp310 Windows wheel（1.23.x）。**但这两个都是「风格」不是「情绪」**：逐条读了 519 类模型的 `id2label`（400 Discogs 风格 + 119 细分风格，如 `Rock---Shoegaze`），**没有 mood/theme 标签**。
3. **Replicate 托管** [`mtg/music-arousal-valence`](https://replicate.com/mtg/music-arousal-valence)：在线按次计费，不适合本地插件。

> ⚠️ 本次 `essentia.upf.edu` 与 `huggingface.co` 网页直连时通时不通（SSL/DNS），**`deam-msd-musicnn` 的官方 R² 未能核实**，只能引用二手（Replicate 页面称其为 MusiCNN embedding + 单隐层 MLP 回归，输出 arousal/valence）。

### 3.2 专用 MER 模型：数字、权重、许可证

**MTG-Jamendo mood/theme（PR-AUC，macro，已核实原文）：**

| 模型 | PR-AUC | ROC-AUC | 口径 |
|---|---|---|---|
| MusiCNN | 0.126 | 0.740 | frozen + probing |
| MERT-95M | 0.134 | 0.764 | frozen + probing |
| MERT-330M | 0.140 | 0.765 | 同上 |
| lileonardo（MediaEval'21 最佳） | 0.151 | 0.775 | 有监督微调 |
| **music2emo（J+D+E+P）** | **0.154** | 0.781 | 微调 + 多任务蒸馏 |

来源：[MERT 论文 Table 2](https://arxiv.org/abs/2306.00707)（mood/theme 列）、[music2emo README 表格](https://huggingface.co/amaai-lab/music2emo)。

**DEAM 回归（R²，已核实 music2emo README）：** valence **0.518** / arousal **0.623**。

**现实检查**：0.15 的 PR-AUC 出现在 56 类极不平衡的多标签任务上，意味着「排序有一点信息，绝对值不可信」。0.134 → 0.154 是 **+15% 相对提升**，且口径不同（probing vs 微调），**不能读成「架构更强」**。放到「6 条自定义 prompt、池里挑 1 首」的场景，这个量级的差异很可能被 prompt 措辞的影响盖过。

**可得性 / 许可 / 体积（HF 文件清单与 cardData 核实）：**

| 模型 | 权重在 HF | 体积 | 权重许可 | 说明 |
|---|---|---|---|---|
| MERT-v1-95M / 330M | ✅ | 360 MB / 1.2 GB | **CC BY-NC 4.0** | 本机 transformers 5.20 **无 mert 模块**，需 4.x 或独立环境；**只有 embedding，没有情绪头** |
| MuQ-large-msd-iter | ✅ | 1.27 GB | **CC BY-NC 4.0** | 无 pip 包、无情绪头；论文未报 Jamendo mood/theme |
| MusicFM | ✅ | — | **MIT** | 24 kHz / 30 s；同样只有 embedding |
| MULE | ✅（`PandoraMedia/music-audio-representations`，`model.keras` 251 MB） | 251 MB | 仓库 GPL-3.0，权重未单独声明 | Keras 权重需转；无官方 PyTorch 版 |
| **music2emo** | ✅ `saved_models/{J,D,E,P}_all.ckpt` + 和弦模型 `btc_model*.pt` | 头部很小（线性层） | **Apache-2.0** | **唯一开箱给 V/A + 56 mood 的**；底座是 MERT（NC）→ 组合实质非商用 |
| deam-msd-musicnn | ❌ | — | CC BY-NC-SA 4.0 | 见 §3.1 |

### 3.3 音频-文本 / 音频大模型：能不能「描述情绪」

这是证据最硬的一块，而且是负面证据。

**MuChoMusic（ISMIR 2024，1187 道四选一、644 首曲，[arXiv 2408.01337](https://arxiv.org/abs/2408.01337)）** 是少数把 **mood and expression** 单列为维度的音频大模型评测。原话：*"current models generally perform poorly across all settings and along all evaluation dimensions"*。该维度准确率：**Qwen-Audio 51.4、SALMONN 41.8、MusiLingo 21.1，随机基线 25.0**。

更关键的是它的「音频注意力测试」：把音频换成白噪声或另一首曲子后，**只有 SALMONN 和 Qwen-Audio 出现显著掉分，其余模型几乎不掉分** → 说明「情绪判断」大量来自文本先验，不是真的在听。

**Qwen3-Omni 报告（[arXiv 2509.17765](https://arxiv.org/abs/2509.17765)）** 两点：
- 音乐情绪在它那里是 **MIR 多标签分类**（GTZAN、Jamendo 四个子集、MagnaTagATune 上的 emotion/theme recognition），不是「生成情绪形容词」；
- 官方自认 *"the research community currently lacks a general-purpose audio captioning model"*，所以另做 **Captioner** 变体压幻觉。

| 模型 | 能给「轻快/忧郁/紧张」吗 | 8 GB 显存 | CPU | 权重许可 |
|---|---|---|---|---|
| Qwen2.5-Omni-7B | 能说人话，但情绪判断无评测背书，易受文本先验影响 | int4 约 3.5–7 GB，**勉强可跑**；bf16 21.3 GB 不行 | 慢（30 s ≈ 750 audio token；**具体时延未核实，推算十几秒到几十秒**） | **Apache-2.0** ✅ |
| Qwen3-Omni-30B-A3B | 同上，MoE 不省驻留显存 | **不行**（bf16 63 GB，int4 仍 25 GB+） | 不行 | Apache-2.0 |
| SALMONN（`tsinghua-ee/SALMONN`） | 41.8%（MuChoMusic），**是少数「真听音频」的** | 7B/13B，需量化 | 慢 | Apache-2.0（上游 Vicuna/Llama2 条款未核实） |
| Audio Flamingo 3 | 能力最强一档，但音乐情绪无专门评测 | 8B，bf16 ≥16 GB 不行，无官方量化 | 不行 | **NVIDIA OneWay 非商用**（原文 "for non-commercial research purposes only"） |
| LP-MusicCaps | **基本不能** | 小，CPU 可跑 | 可 | **MIT** ✅（三个权重各 1.7 GB） |
| MusicGen | 生成模型，不是判别器 | — | — | 未核实 |

**LP-MusicCaps 为什么救不了**：它的训练目标是「标签 → GPT-3.5 生成句子」的伪 caption（Tag-to-Caption），学到的是把标签复述成流畅句子，输出天然偏编制/风格（"a folk song with acoustic guitar"），而不是情绪判断。这是从其方法推断（**推断，非论文原文**），但与现有症状完全对得上。

**小结**：截至今天，**没有任何本地可部署模型能可靠地「用自然语言描述这首曲子听起来轻快/忧郁/紧张」**。要么接受有监督 MER 的粗标签 + V/A 数值，要么用大模型生成描述但必须人工复核。

---

## 4. 推荐方案

### A. 必做：把 CLAP 的用法重做一遍（零新依赖，半天内可完成并验证）

**A1. 全曲分窗，别只听前 45 s 的中段。**
- 现状：`duration=45` → 取中间 30 s（[analyze.py:143-148](../tools/tag/analyze.py)）。
- 改成：解码全曲（最长 4 min），切 **N 个 10 s 窗**（10 s 是 CLAP 训练长度，30 s 已属分布外——这也是不稳定的一个来源），均匀覆盖全曲（如 12 个窗，跳过首尾各 3 s 淡入淡出）。
- 聚合：**逐窗算余弦后取中位数**。中位数对「正好切到间奏」免疫，是「只听中段」这条缺陷的正解。
- 副作用指标：窗间分数的 **max−min** 就是「这首情绪稳不稳」的度量，可进 `auto` 字段当质量分。前后反差大的曲子本来就不该只给一个标签。
- 成本：10 s 输入的 attention 长度约为 30 s 的 1/3，12 个窗的总计算量约为现在 1 个 30 s clip 的 **3–4 倍**，不是 12 倍。

**A2. 去掉 softmax，换「锚点 + 自校准」。**

现在的问题不只是零和：温度 ≈27.4 让余弦差 0.02 就能把概率拉到 0.9/0.1，而且词表一并集就漂。改成：

```
# 1) 绝对分：与「概念锚点」的余弦（锚点 = 3 首公认为该概念的曲子，CLAP 音频向量质心）
raw_c = median over windows w of cos(E_w, A_c)

# 2) 自校准阈值：用锚点内部两两余弦的均值当及格线
t_c   = mean_{i<j} cos(A_i, A_j)
score_c = sigmoid(k * (raw_c - t_c))     # k 用测试集调一次即可
```

- 锚点用**音频侧**而不是文本侧：「轻快」由 3 首真·轻快曲的音频决定，不再由一句英文的措辞决定——从根上消掉「换个 prompt 就翻盘」的脆弱性，且零训练、零新依赖。
- 文本侧保留但降级为**兜底**（新概念还没锚点时用 prompt 集合的平均向量）。
- 跨段可比性随之消失：`raw_c` 是绝对余弦，`t_c` 是概念自己的尺度，与批里还有哪些词无关。
- 顺带修掉 union 词表：每首曲子只在自己的词表上打分。

**A3. 词表进配置。** 把 `FALLBACK_PROMPTS`（[analyze.py:37-50](../tools/tag/analyze.py)）与 `TEXTURE_PROMPTS`（[match.js:9-17](../lib/match.js)）挪进 `settings.json`，`lib/match.js` 只负责「场景 → 概念 id」。

**A4. UI 别显示 softmax 概率。** 0.83/0.16 会让人以为是置信度，实际只是同批内的相对占比。显示 `raw_c`（余弦，0–1）与 `score_c`（校准后）更诚实。

### A+. 强烈建议一起做：音频锚点 few-shot

A2 已含锚点机制，这里单列强调：**每个概念手工挑 3 首「公认」曲子当锚点，是整套方案里性价比最高的一步**。锚点可直接用 §5 测试集里的曲子（一举两得）。锚点存成小 json（曲子 id + 概念 id），`analyze.py` 启动时算一次质心并缓存。

### B. 可选加装：music2emo 提供「绝对情绪轴」

**何时加**：A + A+ 跑完 §5 回归测试，若「轻快 vs 安静」仍分不开（禁忌标签仍进 top-3），再上 B。

**怎么装（隔离环境，别污染现有 venv——pins 不兼容）：**

```
# 现有环境: torch 2.14 / transformers 5.20 / librosa 0.11
# music2emo: torch 2.3.1 / transformers 4.44 / librosa 0.10.2 / pytorch_lightning 2.4
E:\Software\Python310\python.exe -m venv E:\Software\audioml-m2e
E:\Software\audioml-m2e\Scripts\pip install torch==2.3.1 torchaudio==2.3.1 --index-url https://download.pytorch.org/whl/cpu
E:\Software\audioml-m2e\Scripts\pip install -r <music2emo>/requirements.txt
# 权重：huggingface-cli download amaai-lab/music2emo --local-dir <music2emo>
```

- 输出：`{"valence": 1-9, "arousal": 1-9, "predicted_moods": [...]}`（56 类 Jamendo mood）。
- 用法：**当门控与重排特征，不要当唯一判决**。例：恐怖段要求 arousal 高且 valence 低；安静钢琴要求 arousal 低。R² 0.52/0.62 足够做粗门控，不足以做 1–9 的精细排序。
- 体积：MERT-95M 360 MB + 4 个 ckpt（线性头，很小）+ 和弦模型；CPU 单段**预计数秒级**（未实测）。
- 风险：torch 2.3.1 在 py3.10 有 wheel 没问题；但 `mir_eval / pretty_midi / music21 / chordparser` 均为纯 Python sdist，**Windows 上未实测**，和弦解析是最大不确定性。卡住时的退路：**只取 MERT embedding 自己训一个 V/A 线性回归头**（公开 DEAM 标注 + 已装的 sklearn），约 1 天。

### C. 不建议做

| 方案 | 否决理由 |
|---|---|
| Essentia 本地 | 无 Windows wheel（含 2026-05 最新版）+ AGPL + 模型 NC-SA |
| Audio Flamingo 3 | 非商用专用许可 + 8B 在 8 GB 上要量化 + 音乐情绪无评测背书 |
| Qwen3-Omni-30B | 8 GB 显存不现实（MoE 不省驻留显存） |
| 用 MERT / MuQ「直接替换」 | 只出 embedding，无情绪头；本机 transformers 5.20 连 MERT 模块都没有；权重还是 NC |
| LP-MusicCaps 当情绪描述器 | 训练目标是复述标签，输出必然偏编制/风格 |

**Qwen2.5-Omni-7B 的正确定位**（唯一「许可干净 + 勉强跑得动」的大模型）：**离线扩词表、写候选描述，人工筛完再进锚点库**。不要放进每次打标的路径——一批 10 首 × 几十秒会让 `timeoutMs=600000` 直接吃不消。

---

## 5. 最小回归测试

### 5.1 语料：7 首

| # | 类型 | 期望标签（1–3） | 禁忌标签（进 top-3 即算错） | 期望 V/A（可选，1–9） |
|---|---|---|---|---|
| 1 | 轻快日式民谣《ひやむぎ、そーめん、时々うどん》 | 轻快、民谣木吉他 | 恐怖、暗色氛围 | V 高 / A 中 |
| 2 | 有节奏的说唱（中文） | 律动 | 安静钢琴、史诗管弦 | V 中 / A 高 |
| 3 | 安静钢琴（Yiruma 类） | 安静钢琴、忧伤 | 激烈攻击、恐怖 | V 低 / A 低 |
| 4 | 恐怖氛围（无调性 + 高频摩擦） | 恐怖配乐、暗色氛围 | 轻快、民谣木吉他 | V 低 / A 中高 |
| 5 | 暗黑 drone / 工业 | 暗色氛围、电子脉冲 | 轻快 | V 低 / A 中 |
| 6 | 史诗管弦 | 史诗管弦 | — | V 中高 / A 高 |
| 7 | **对照：第 1 首的间奏段**（自切 30 s） | 应与整曲明显不同 | 用它暴露「单窗」缺陷 | — |

**关键纪律**：先把这 7 首**解码成固定 wav 快照**（mono、48 kHz、整曲），所有实验臂吃同一份文件。否则各臂各自去网易云拉流，码率/前奏一变，对比就不成立。

### 5.2 五个实验臂（分离变量）

| 臂 | 内容 | 回答什么问题 |
|---|---|---|
| **A0** | 现状：前 45 s 中段 30 s + 单句 prompt + softmax | 基线 |
| **A1** | 只改分窗：全曲 12×10 s + 单句 prompt + softmax | 「多窗」值多少 |
| **A2** | A1 + prompt 集合（每概念 5 句取平均） | 「prompt 集合」值多少（已知有效，量化它） |
| **A3** | A2 + 去 softmax + 锚点余弦 + 自校准（§4.A2） | 「换打分方式」值多少 |
| **B** | A3 + music2emo 的 V/A 做门控（可选） | 「加专用模型」还有多少边际收益 |

**若 A3 已达标，B 就不必做**——这正是该设计要回答的问题。

### 5.3 指标

1. **Top-1 命中率**：期望标签是否排第一。7 首，0–7。主指标。
2. **禁忌命中数**：禁忌标签进 top-3 的次数。**比相关系数更贴近痛点**——判错「轻快」只是排序问题，把恐怖片配成轻快民谣是事故。
3. **NDCG@3**：期望标签给 2/1/0 分，算排序质量。样本少时比 Top-1 稳。
4. **跨段可比性 Δ**：同一标签在「该高」与「该低」的曲子上的分数差。softmax 下 Δ 可能 ≈0 甚至反向；锚点余弦下应显著为正。报告 **Δ 的符号正确率**。

### 5.4 判定规则（先写死，防事后自我说服）

- **通过**：`Top-1 命中 ≥ 基线 + 2` **且** `禁忌命中不增加`。只满足一条 → 不通过。
- **A3 与 B 差距 < 1 首** → 不引入 music2emo，收益来自数学修正而非模型。
- 每首歌**换 3 组不同窗偏移**各跑一次，报告均值与极差；极差大说明方案对切窗敏感（本身也是有用信息）。
- 总推理次数 7 × 5 臂 × 3 次 = 105 次；CLAP CPU 上 10 分钟内可跑完（A1–A3 窗更短，单次不慢于现在的 30 s）。

### 5.5 最容易踩的坑

- 各臂**不同的解码参数**（见 5.1）：必须共用 wav 快照。
- **拿测试集调 k 和阈值再用同一批测**：会过拟合。要么留 2 首不参与调参，要么只用锚点内部余弦定阈值（§4.A2 的 `t_c` 天生不需要标签）。
- **用 softmax 概率当置信度跨臂比较**：不同臂词表不同，概率不可比，只比排序。

---

## 6. 汇总表：安装 / 体积 / 耗时 / 许可

| 方案 | 安装 | 体积 | CPU 单曲耗时 | 权重许可 | 判定 |
|---|---|---|---|---|---|
| **A / A+（CLAP 重修）** | 无需安装（用现有环境） | 0 | 与现在同量级（3–4×） | CLAP Apache-2.0 ✅ | **必做** |
| B music2emo | 独立 venv + 4 个 ckpt | ~360 MB + 小头 | 数秒（**未实测**） | Apache-2.0，底座 MERT **NC** | 可选，看 A3 结果 |
| Qwen2.5-Omni-7B（离线扩词） | 独立 venv + int4 量化 | 21.3 GB bf16 / int4 ≈3.5–7 GB | 十几秒–几十秒（**推算**） | Apache-2.0 ✅ | 只做离线工具 |
| Essentia DEAM | **Windows 装不了** | — | — | AGPL + NC-SA | 否 |
| MERT / MuQ 直用 | 需降 transformers 或独立环境 | 360 MB / 1.27 GB | 数秒（**未实测**） | CC BY-NC 4.0 | 只有 embedding，否 |
| MusicFM | 独立环境 | — | 未实测 | MIT ✅ | 无情绪头，暂缓 |
| LP-MusicCaps | 独立环境 | 1.7 GB | 未实测 | MIT ✅ | 描述不了情绪，否 |
| Audio Flamingo 3 | transformers 5.20 原生支持 | ≥16 GB | 否 | NVIDIA 非商用 | 否 |

---

## 7. 核实状态

### ✅ 本机实测核实
- Python 3.10 / torch 2.14.1+cpu / transformers 5.20.2 / librosa 0.11；CUDA 不可用；RTX 3060 Ti 8 GB。
- transformers 5.20.2 **无 `mert` 模块**（导入报 ModuleNotFoundError）；有 `clap` / `qwen2_5_omni` / `qwen3_omni_moe` / `audioflamingo3` / `musicgen` / `ast`。
- 未安装 essentia / onnxruntime / tensorflow / torchaudio；scikit-learn 1.7.2 已装。
- CLAP 缓存无权重（约 3 MB 元数据）；`analyze.py` 用 union 词表 + softmax；`duration=45` 截断。

### ✅ 联网核实（附出处）
- PyPI：`essentia` 226 文件 / 0 Windows；`essentia-tensorflow` 79 / 0；最新 2026-05-19 版本仅 mac + manylinux。
- Essentia 许可：AGPL-3.0-only（PyPI）+ 模型全 CC BY-NC-SA 4.0（[licensing 页](https://essentia.upf.edu/licensing_information.html)）。
- 体积：CLAP 740 MB；MERT-95M 360 MB / 330M 1.2 GB；MuQ-large 1.27 GB；LP-MusicCaps 3×1.7 GB；Qwen2.5-Omni-7B 21.3 GB；MAEST ONNX 347 MB。
- 许可（HF cardData）：MERT/MuQ = CC BY-NC-4.0；MusicFM = MIT；music2emo = Apache-2.0；LP-MusicCaps = MIT；Qwen2.5-Omni / Qwen3-Omni = Apache-2.0；SALMONN = Apache-2.0；AF3 = NVIDIA OneWay 非商用；MAEST/discogs 系 = CC BY-NC-SA-4.0。
- 数字：Jamendo mood/theme PR-AUC（MusiCNN 0.126 / MERT-95M 0.134 / MERT-330M 0.140 / lileonardo 0.151 / music2emo 0.154）；DEAM R² V 0.518 / A 0.623；MuChoMusic mood 维度（Qwen-Audio 51.4 / SALMONN 41.8 / 随机 25.0）；Qwen3-Omni 报告承认缺通用音频 captioner。
- 400 类 / 519 类 MAEST 的标签**全是风格，无情绪**（逐条读 id2label）。

### ⚠️ 未核实 / 只有二手
- `deam-msd-musicnn` 的官方 R² 与输入参数（essentia.upf.edu 本机 DNS/SSL 不通）。
- 各模型 **CPU 单段时延**（无公开数字，只能给量级推算）。
- CLAP 零样本 vs 有监督 MER 的**同口径头对头**数字（没找到论文做过；目前最大的证据缺口）。
- MuQ 在 Jamendo mood/theme 上的表现（论文未报）。
- SALMONN 上游 Vicuna/Llama2 条款是否与 Apache-2.0 冲突。
- `analyze.py` 到底从哪加载到 740 MB 权重。

### 🔶 推断（非文献结论）
- 「10 s 窗比 30 s 窗更稳」——基于 CLAP 训练长度，未实测。
- 「12 个 10 s 窗总计算量约 3–4 倍」——按 attention 长度估算，未实测。
- 「LP-MusicCaps 输出偏编制/风格」——从其 Tag-to-Caption 方法推断。
- 「music2emo 在 Windows 上会卡在和弦解析」——基于依赖清单判断，未实测。

---

## 8. 下一步（按顺序，每步有明确出口）

1. **确认权重从哪来**（10 分钟）。缓存里没有 740 MB 的 CLAP 权重；不搞清楚，后面所有基线都不可信。
2. **搭 §5 的 7 首 wav 快照 + 打分脚本**（半天）。这是唯一能回答「哪项改动有效」的东西，比继续查模型值钱。
3. **跑 A0–A3**（半天，不需装任何东西）。A3 达标即收工，不要碰新模型。
4. **A3 不达标再上 B**（1–2 天）。先按官方 requirements 装独立 venv；卡在和弦解析就退到「MERT embedding + 自训 V/A 线性头」。
5. **长期**：每次在 `bgm_pick` 里确认选曲就是一条标注。攒到 50–100 条后在 CLAP/MERT embedding 上训线性头（sklearn 已装），比任何通用模型都更贴口味——**这是本报告里唯一会随使用越变越准的方案**。

---

## 附录 A：核实命令（可复现）

```powershell
# 1) Essentia 有没有 Windows wheel（看 simple 索引比看 PyPI 页面快）
$c = (Invoke-WebRequest -UseBasicParsing "https://pypi.org/simple/essentia/" ).Content
([regex]::Matches($c,'>([^<]+\.(whl|tar\.gz))<') | % { $_.Groups[1].Value }) -match 'win'

# 2) HF 模型的许可证与体积
Invoke-RestMethod "https://huggingface.co/api/models/m-a-p/MERT-v1-95M" | % cardData
Invoke-RestMethod "https://huggingface.co/api/models/m-a-p/MERT-v1-95M/tree/main"   # 含 size

# 3) 本机 transformers 有没有 MERT
& 'E:\Software\audioml\.venv\Scripts\python.exe' -c "import transformers;print(hasattr(transformers,'MertModel'))"
```

## 附录 B：参考链接

- MuChoMusic（音乐情绪维度的音频大模型评测）：https://arxiv.org/abs/2408.01337
- Qwen3-Omni 技术报告：https://arxiv.org/abs/2509.17765
- MERT 论文（Table 2 含 mood/theme）：https://arxiv.org/abs/2306.00707
- music2emo 论文 / 仓库：https://arxiv.org/abs/2502.03979 、https://huggingface.co/amaai-lab/music2emo
- MuQ 论文：https://arxiv.org/abs/2501.01108
- Essentia 许可说明：https://essentia.upf.edu/licensing_information.html
- Essentia 模型列表：https://essentia.upf.edu/models.html
- MAEST ONNX 移植：https://huggingface.co/avari1250/discogs-maest-30s-pw-129e-onnx
- MTG 托管 V/A 服务：https://replicate.com/mtg/music-arousal-valence

---

## 9. 补充调研：放开「可调用 API / 线上服务」之后（同日追加）

> 本节推翻 §4.B 的结论（不再建议装 music2emo），其余不变。
> 价格读取日期均为 2026-11-18；人民币按 **¥7.1/$** 折算（假设汇率，非实时）。

### 9.1 结论：变了两处，没变一处

**没变**：**日常每首歌的排序仍然必须留在本地**（§4.A + A+ 的锚点方案）。理由不是钱（线上比想象的便宜得多），而是三件事本地才有：可复现、不外发音频、零延迟。

**变了**（两处）：

1. **§4.B「装 music2emo」降级为备选，改用「线上教师标注 + 本地蒸馏」。**
   线上打标 API 一次 ¥0.5/首，标 500 首 = ¥250；装 music2emo 要 1–2 天且受 MERT 的 NC 许可与老版本 pins 拖累。**买标注比装模型划算**，而且买来的标注可以蒸馏进本地 CLAP embedding，得到一个「按你自己的标签体系训练」的小头——永久、离线、免费、可复现。这比用别人的情绪头更贴需求。
2. **新增两个本地做不到的能力**：
   - **绝对情绪轴**：Replicate 的 MTG V/A 回归 **$0.0022/次（约 ¥0.016），且与音频时长无关**；
   - **自然语言解释**：Gemini Flash-Lite 级模型 **约 ¥0.01/首**，只对候选池 top-3 生成一句理由，写进 `review.md` 帮人工拍板，不参与排序。

### 9.2 四类线上方案（已核实的价格与能力）

| 类别 | 服务 / 模型 | 能力 | 价格 | 能不能用 |
|---|---|---|---|---|
| **专用音乐打标** | 火山引擎「音乐标签」 | 曲风 / **情绪** / 场景 / 语言 / 二级曲风 5 维，**带概率**；≤10 分钟、≤100 MB；可传公网 URL 或 base64 | **0.5 元/次**（≤1000 次/月）；0.4 / 0.35 / 0.3 阶梯；次数包 1000 次 400 元；**50 次免费 / 3 个月** | ✅ 最实用；标签体系不是你的，需映射 |
| 专用音乐打标 | Music.ai `Music Metadata (by Cyanite)` | Cyanite 那套：13 个主导情绪 + **~130 个进阶情绪**（`horror` `eerie` `tense` `suspenseful` `ominous` `epic` `heroic` `triumphant` `melancholic`…）+ valence/arousal(−1~1) + energyLevel | **$0.15/分钟**（3 分钟 ≈ $0.45 ≈ ¥3.2） | ⚠️ 标签最对口，但转售层，**「非商业开源」条款未核实** |
| 专用打标（直连） | Cyanite 官方 API | 同上，且更全 | **无公开价**；官方明写 "only available to enterprise customers"，无公开注册 | ❌ 企业销售 |
| **专用 V/A 回归** | Replicate `mtg/music-arousal-valence` | arousal/valence 回归，CPU，约 22 秒 | **≈$0.0022/次**（= CPU $0.0001/秒 × 22 秒），**与音频长度无关** | ✅ 便宜到可忽略；CC BY-NC-SA；需出境 |
| 专用（风格） | Replicate `mtg/effnet-discogs` | 400 种 Discogs 风格 | **≈$0.00017/次** | ✅ 几乎免费，但只是风格 |
| **通用音频大模型** | Gemini 3.5 Flash-Lite / 3.8 Flash | 自由文本描述 / 按给定 JSON 词表打分 | **25 token/秒**；Flash-Lite $0.30/1M、3.8 Flash $0.75/1M（均不分模态） | ✅ 极便宜；但情绪判断力见 §3.3（MuChoMusic 负面证据） |
| 通用音频大模型 | OpenAI `gpt-audio-1.5` | 同上 | **10 token/秒**；音频输入 $32/1M | ⚠️ 贵 10–20 倍；`gpt-audio-mini` 已弃用、`gpt-4o-audio-preview` 已 shutdown |
| 通用音频大模型 | 阿里百炼 `qwen3.8-omni-flash` | 同上 | 输入 ¥0.8/M token，**7 token/秒**（=¥0.0002/30 秒）；**100 万 token 免费 / 90 天** | ✅ 便宜到等于免费 |
| 已死 / 不可用 | Musiio | 曾有 41 种情绪 | — | ❌ 站点 302 到 soundcloud.com（收购方是 **SoundCloud**，不是 Splice） |
| 已死 / 不可用 | Spotify Audio Features | valence / energy | 免费 | ❌ 2024-11-27 起**新应用禁用**；且只覆盖 Spotify 曲库，不接上传 |
| 已死 / 不可用 | AcousticBrainz | 6 个粗情绪 + timbre | 免费、CC0、无 Key | ⚠️ API 还通，但**只按 MBID 查 2022 年前收录的录音**，自制/同人曲 100% 查不到 |
| 不对口 | ACRCloud | 指纹识别（认歌名） | 需登录看价 | ❌ 唯一的分类输出是 music/speech |

### 9.3 成本模型

### A. 单曲与批量

| 方案 | 单价口径 | 单曲（3 分钟） | 20 首 / 模组 | 1000 首 / 年 |
|---|---|---|---|---|
| 本地 CLAP（§4.A，推荐主干） | 0 | **¥0** | ¥0 | ¥0 |
| 火山音乐标签 | ¥0.5/次 | ¥0.50 | **¥10** | ¥400（次数包） |
| 火山（首年，含 50 次免费） | — | — | ¥10 | ¥375 |
| Music.ai / Cyanite | $0.15/分钟 | ¥3.20 | ¥64 | ¥3,195 |
| Replicate MTG V/A | $0.0022/次 | **¥0.016** | ¥0.31 | ¥16 |
| Gemini 3.8 Flash | $0.75/1M tok | ¥0.024 | ¥0.48 | ¥24 |
| Gemini 3.5 Flash-Lite | $0.30/1M tok | ¥0.010 | ¥0.19 | ¥10 |
| OpenAI gpt-audio-1.5 | $32/1M tok | ¥0.41 | ¥8.2 | ¥409 |
| 阿里 qwen3.8-omni-flash | ¥0.8/M tok | ¥0.001 | ¥0.02（免费额度内 ¥0） | ≈¥0 |

> **成本与时长解耦**是 Replicate 那条路最反直觉的优势：3 分钟整曲和 30 秒片段都是 $0.0022。

### B. 一次性投入（用来换「永久本地能力」）

| 用途 | 火山 | Cyanite/Music.ai |
|---|---|---|
| 7 首回归测试集（§5） | **¥0**（用免费额度） | ¥22 |
| 100 首锚点 / 金标 | ¥25（先用掉 50 次免费） | ¥320 |
| 500 首蒸馏训练集 | **¥250** | ¥1,600 |

**盈亏平衡**：装 music2emo 要 1–2 天。若你的时间按 ¥200/天算，就是 ¥200–400 —— **正好等于火山标 500 首的钱**。差别在于：买标注换来的是「你自己的标签体系 + 永久离线 + 可蒸馏」；装模型换来的是「别人的 56 个 Jamendo 情绪词」。

### C. 如果只愿意花 ¥50，花在哪

1. **火山 50 次免费额度**：先跑 §5 的 7 首 + 43 首候选，拿「情绪概率」当参照系（¥0）。
2. 拿结果做**映射表**：火山情绪标签 → 你的 12 个概念。
3. 剩下的钱留给 Replicate V/A 跑几百首（¥16/1000 首）做绝对轴校准。

### 9.4 修正后的架构（三层）

```
L0 本地 CLAP（始终跑，¥0）
   全曲 12×10s 分窗 + 锚点余弦 + 自校准  →  排序与分数
        ↑ 锚点从哪来？
L1 线上教师（一次性，¥25–250）
   火山音乐标签 / Cyanite  →  结构化标签  →  人工映射表  →  锚点库
   更进一步：500 首标注 + 本地 CLAP embedding 训线性头 = 永久免费的私有模型
L2 线上解释（按需，¥0.01/首）
   Gemini Flash-Lite  →  只给 top-3 写一句理由  →  进 review.md，不参与排序
```

关键点：**L1 是一次性的、L2 是可选的，L0 才天天跑。** 这样线上的不稳定性、隐私、计费都不会进入日常路径。

### 9.5 线上方案新增的六个风险

1. **模型生命周期短于项目生命周期**。实证：`gpt-4o-audio-preview` 已 shutdown、`gpt-audio-mini` 已弃用、**Gemini 2.5 Flash 在 2026-12-01（13 天后）自动路由到 3.5 Flash-Lite 并按后者计费**。→ 任何云端结果必须落库，缓存键含 `provider + model + 版本 + 日期`，并保存原始 JSON，否则半年后无法复现。
2. **第三方价目表会错**。OpenRouter 上 `gpt-audio-mini` 的 audio 价返回 $0.60/1M，官方是 $10/1M（差 16 倍）。→ 成本估算只信厂商自己的定价页。
3. **上传即外发**。把网易云缓存的受版权音频发给第三方，个人研究风险低；但把这段逻辑写进开源工具，等于替他人批量外发版权音频。→ 默认关闭、显式开关、README 写明「仅处理你有权处理的音频」。
4. **计费失控**。批量循环 + 超时重试会重复计费。→ 必须本地缓存（按 song_id）+ 单次运行预算上限。
5. **标签体系互不兼容**。火山（曲风/情绪/场景）、Cyanite（130 词）、Jamendo（56 词）三套词表，映射表要单独维护，换供应商等于重做映射。
6. **免费额度会过期**。火山 50 次免费限「开通之日起 3 个月」，别囤着不用。

### 9.6 下一步（¥0 即可完成）

1. 用火山 **50 次免费额度** 跑 §5 的 7 首测试集 + 43 首候选；
2. 把返回的「情绪 + 概率」按 §5.3 的同一套指标（Top-1 命中 / 禁忌命中）打分，与 L0 本地结果并排；
3. 若火山在你的 12 个概念上明显更准 → 考虑蒸馏（§9.4 L1）；若不准 → 说明**问题确实不在"谁更会打标"，而在于你的概念需要自定义**，回到 §4.A2 的锚点方案；
4. 只有在这两步都做完之后，才值得考虑 Music.ai/Cyanite 的付费金标。

### 9.7 本节核实状态

**✅ 我直接读到官方页面**
- 火山音乐标签计费：0.5 / 0.4 / 0.35 / 0.3 元每档、次数包 1000次400元、50 次免费 3 个月、并发 10（[产品计费页](https://docs.volcengine.com/docs/audio-technology/product-billing-3?lang=zh)，页面更新时间 2023-05-22）。
- Replicate `mtg/music-arousal-valence`：≈$0.0022/次、454 次/$1、CPU、22 秒（[模型页](https://replicate.com/mtg/music-arousal-valence)）。

**✅ 子代理读到官方页、我未逐条复看**
- 火山「曲风/情绪/场景/语言/二级曲风 5 维带概率」的能力描述（接口说明页）。
- OpenAI / Gemini / OpenRouter / DeepInfra 的单价与 token 换算率（10 token/秒、25 token/秒）。
- Music.ai $0.15/分钟、Cyanite 企业专属、Musiio 已死、Spotify 新应用禁用、AcousticBrainz 冻结。

**⚠️ 未核实**
- 火山的**情绪标签词表原文**（有哪些情绪词、多少类）——这直接决定它能不能对上你的 12 个概念，**建议开通前先看接口文档或直接跑一次免费额度**。
- 火山音乐标签的单次响应时延。
- Music.ai 对「非商业开源项目」的条款。
- 阿里 qwen3.8-omni-flash 的音乐情绪判断质量（无评测）。
- Cyanite 直连的最低价与最低消费。

---

## 10. 选型决定（「先不谈成本」口径）

**最合适 = 在音乐 embedding 上训一个「你自己的多标签头」；大模型只当教师与解释器，不当打分器。**

理由：现有所有方案都在回答**别人的分类问题**（Jamendo 56 情绪词 / Cyanite 130 词 / 火山「曲风·情绪·场景」/ CLAP 英文句子），而 `cues.json` 要的是**织体 + 场景 + 情绪的混合**（「民谣木吉他 + 轻快」「电子脉冲」「军鼓行进」「太空氛围」），没有一家现成词表覆盖。

四条支撑：

1. **结构错配**：`cues.json` 的 `valence / energy / texture[] / wants[]` 本就是多标签 + 连续轴，而零样本 softmax 把它压成单标签。多标签头天然对得上。
2. **概念自定义**：`军鼓行进`、`电子脉冲` 不是情绪词，任何厂商词表都没有。
3. **可比与可复现**：只有本地模型给得出（云端模型会变、会下线）。
4. **越用越准**：`bgm_pick` 每次确认选曲就是一条标注，SaaS 拿不走，只有自训头用得上。

形态（三层，接口与 §4.A2 兼容，因此可以逐步替换）：

```
embedding（本地缓存）：MuQ-large / MERT-330M / CLAP —— 用同一批标注 A/B，谁好用谁
   每 10s 窗一个向量 → 整曲 mean + std 拼接（std = 情绪不稳的程度）
多任务头（本地，几万参数）：valence 回归 + energy 回归 + texture 多标签 + 场景概念多标签
match = 该 cue 的期望标签向量加权相似度（权重手写，可解释）
解释层（可选）：只对 top-3 生成一句「听起来是 X，因为 Y」→ review.md
```

- **过渡**：标注不足 300 条时用 §4.A+ 锚点（等价于「每类 3 个样本的最近质心」），与最终方案共用 embedding 与打分接口，换的只是「质心 → 训练好的头」。
- **验收**：§5 的 7 首上 Top-1 ≥ 6/7、禁忌命中 = 0；同一首跨池分数不变；窗间 std 高则自动标「情绪不稳」。
- **工程前提**：CLAP 已装好；MERT 需独立环境（本机 transformers 5.20 无 `mert` 模块）；MuQ 需其仓库代码。所以顺序是：先做 CLAP 头 → 不够再换 embedding。

**明确不选**（针对本需求，非通用评价）：通用 LALM 当打分器（不可校准、易受文本先验影响）、Cyanite/火山当主路径（词表不对口）、Jamendo/MERT 现成情绪头（56 词、PR-AUC 0.15）、Essentia 本地（Windows 装不了）。

---

## 11. 附议：「借别人的词表 + 语言模型做文本匹配」是否可行

> §10 里「没有一家词表覆盖」的说法过强。准确说法是：**约 2/3 可映射，剩下 1/3 是织体/场景长尾**。按这条标准，借词表是一条成立的路，且是当前最优的冷启动方案。

**机制**：把两件事拆开——音频→固定标签（有监督，可靠、可比）；描述→同一套标签（纯语言任务，LLM 强项）；再用概率向量对齐。这正是 CLAP 零样本没做的：它把「听」和「理解词义」压进同一个余弦，于是一句 prompt 的措辞就能翻盘。

**但它换了一个失败模式**：从「选错模型」变成「投影误差被语言模型掩盖」。`军鼓行进` 在词表里找不到对应时，最近邻可能是 `percussion + epic + uplifting`，LLM 会**自信地把它们匹配上去**，返回一个看着很合理的分数。→ **真正要解决的不是「能不能匹配」，是「匹配失败时能不能被发现」。**

**四个补丁，缺一不可：**

1. **用概率向量，不要 softmax。** 多标签 sigmoid 输出才跨曲可比。
2. **映射表离线冻结、人工审。** LLM 起草 → 人定稿 → 落成 `vocabulary.json`（与现有 `lib/vocabulary.js` / `docs/vocabulary.example.json` 是同一个位置）；**不要每次让 LLM 现编**，否则不可复现也无法调。
3. **覆盖率守卫**：`max(p_i)` 低于阈值 τ，或期望标签的映射项全部缺失 → 判「词表覆盖不足」，不给分、不参与排序。没有这一步，错误会静默。
4. **词表必须含 instrument / 织体维度**（Jamendo 有 instrument 标签，Cyanite 有 movement/instrument）。否则「电子脉冲 / 军鼓行进」永远是错的。

**确定性打分**（解释免费得到，不需要 LLM 参与打分）：

```
w(cue) = 冻结映射表给出的标签权重（如 轻快 → {happy:1.0, acoustic:0.6, mellow:0.3}）
score  = Σ w_i · p_i / Σ w_i          # 加权均值，0–1
reason = 贡献最大的 3 个标签 + 各自概率
coverage = max p_i (i ∈ supp(w))
```

**三种用法（按可复现性排序）**：A 概率向量加权余弦（主路径）；B LLM 只在 A 之上重排 top-3 并写理由（可选）；C LLM 直接判匹配度（最灵活、最不可复现，只做人工复核）。

**与锚点方案的最优组合**：用借来的词表**挑锚点**（按 `melancholic` 概率取 top-3 当「忧伤」的锚点），再用锚点做绝对打分。这样映射表只用于「选锚点」，不进日常打分路径，鲁棒性最高，也解决了「谁来定义锚点」的问题。

**何时不该用**：能在目标词表里找到 top-3 直接对应的概念 < 70%，或核心概念强依赖编制而词表没有 instrument 维度。此时退回 §10 的自训头。

**结论**：借词表是**冷启动层**，不必是终态。它比 §10 的方案少 5 天工作量、当天可验证，且天然可解释；代价是精度天花板由别人的词表决定。

---

## 12. 「借词表 + 文本匹配」与现有实现的对比结论

**结论：在架构上更好，但要拆成三件事看——两件是净胜，一件是净负。**

### 净胜 1：`lib/match.js` 的正则映射 → LLM 语义映射

现状：15 条硬编码正则（[match.js:20-36](../lib/match.js)），`wants` 是自由文本，命中不到就只剩 1 条兜底 prompt（[match.js:80](../lib/match.js)）。场景写「余烬里的低语」时，映射层直接失效且**没有报错**。

LLM 映射在这件事上严格更强：中文、隐喻、组合描述都能处理，且映射结果可落盘、可人工复核。

### 净胜 2：`softmax` → 概率向量

现状：12 条全局 + 各段 prompts 的 union 上做 softmax（[analyze.py:102-108](../tools/tag/analyze.py)、[analyze.py:153](../tools/tag/analyze.py)），跨批不可复现，加一个标签会让其他所有分数漂移。

固定词表 + 多标签概率彻底消掉这一类问题：加概念不影响既有分数，跨曲可比。

### 净胜 3：可解释性

现状给出「恐怖配乐 0.87」这种无法追责的数字（且 softmax 后它并不代表置信度）。词表法天然给出「命中哪几个标签、各多少概率」，理由免费得到。

### 净负 1：开放词表 → 封闭词表

这是唯一真正的损失，而且必须承认：**CLAP 零样本的唯一结构性优势就是「你可以用自然语言问任意问题」**。「军鼓行进」可以直接写成 `marching snare drums` 去比；换成借来的词表，它必须被投影到词表里最接近的东西上——这一步的误差会被语言模型掩盖（见 §11）。

按 Jamendo 的 195 标签（genre/instrument/mood-theme）与 Cyanite 的 130 情绪词估算，现有 12 个概念里约 **8 个**能直接映射，**4 个**（电子脉冲、军鼓行进、太空氛围、暗色氛围的边缘含义）落在长尾。这是估算，非实测。

### 因此最终形态不是「替换」，而是三段拼接

| 层 | 用什么 | 拿什么 |
|---|---|---|
| 封闭部分（情绪轴 + 主流情绪标签） | 有监督 tagger（Jamendo 头 / Cyanite / 火山） | 准、可比、可解释 |
| 长尾部分（织体 / 场景） | CLAP 零样本 + 锚点 | 全（开放词表） |
| 描述 → 权重 | LLM 离线映射 + 人工冻结 | 通（中文语义） |
| 融合 | 加权，**不**再 softmax | — |

**落地顺序**（前两步不需要任何新依赖，可当天做）：
1. 把 `lib/match.js` 的正则换成「LLM 起草 + 人工冻结」的映射表；
2. 把 softmax 换成概率向量 / 锚点余弦；
3. 再决定要不要引入 tagger 补封闭部分。

**一句话**：你提的方案里最有价值的两件事（语义映射、概率向量）**与换不换模型无关**，可以先在原地实施；只有第三件（换成有监督 tagger）才需要新依赖。做完前两步再评估，差距可能已经小到不值得引入第三个模型。

---

## 13. 勘误：对比基准已从 v1 变成 v2

本文 §10–§12 写作时读的是 `analyze.py` / `match.js` 的 v1（12 条兜底 prompt、单窗 45 秒、正则直接生成英文句子）。之后工作区被改成 v2，以下结论需要修正：

| 项 | v1（我评的） | v2（现状） |
|---|---|---|
| 概念数 | 12 条硬编码 | **29 个**，`lib/vocabulary.js`，可被 `$DSH_HOME/bgm-prep/vocabulary.json` 覆盖 |
| 每个概念的文本 | 1 句 | **3–5 句取向量平均** |
| 音频取段 | 前 45 秒的中段 30 秒 | **开头/中间/结尾各 20 秒**，最长 180 秒（`WINDOW_SECONDS=20`） |
| `match.js` | 正则生成英文 prompt | 正则生成**概念标签**（18 条关键词 + 7 个织体） |
| 打分 | softmax | **仍是 softmax**（`analyze.py:166`） |

**需要修正的结论**：
- §12「净负 1（封闭词表）」的力度减弱——v2 的词表已经外置且可覆盖，“可扩展”这个诉求本身已解决；
- §12 的「12 个里 8 个能映射」作废。按 29 个概念粗分：情绪/氛围约 9、织体/音色约 8、风格约 4、音效/环境约 6、场景/功能约 2、元属性 1；估计可借词表覆盖 **约 19/29（65%）**，音效类基本无解（**估算，未实测**）。
- §4.A1（多窗）、§4.A3（词表外置）**已落地**，不必再做。

**不需要修正的结论**：softmax 仍在（§12 净胜 2 成立）；正则映射仍在（§12 净胜 1 成立）；§11 的四个补丁仍成立。

---

## 14. 框架修正：两层架构（描述层 / 决策层）

> 用户指出：词表不是“用来找对得上词表的曲子”，而是“用来找符合场景的曲子”。只要能清楚知道一首歌是什么情绪氛围，即使用分析器**固有的**标签体系，再与场景二次比对也成立。
>
> **这个纠正是对的，而且纠正的是论证框架：我把词表当成了「契约」，它其实是「坐标系」。**

### 14.1 两层拆分

```
描述层（可替换、可缓存、与场景无关）
   音频 → 固定维度的描述向量（标签概率 / V-A / 乐器命中 / 原始相似度）
        ↓ 一次算好，落盘
决策层（可调、可解释、承载你的口味）
   场景描述 → 同一空间的软目标向量（LLM 起草 + 手写权重）
        ↓
   score = 相似度(描述向量, 目标向量)；权重可改，音频不必重跑
```

### 14.2 这个拆分的三个实际好处

1. **分析器可替换**：换模型只换描述层，决策层不动。
2. **可缓存（最被低估的一条）**：固定描述向量一次算好落盘，之后调权重、改场景、加概念都不必重跑音频。而 CLAP 零样本的做法（把 prompt 拼进打分）**做不到**——换个说法就得重算，且分数会漂。
3. **可归因**：选错时能分清是「看错了歌」（描述层错）还是「配错了场」（决策层错）。端到端训练给不了这个。

### 14.3 但它有一个必须满足的条件

**描述层必须保住你决策时要用的区分。** 两个失败模式：

- **量化丢失**：描述空间里没有“织体/编制”轴，钢琴与合成器都塌成 `calm`，第二层再聪明也补不回来——**第二层只能重新加权，不能创造信息**。
- **投影偏置**：在西方流行/电子语料上训练的标签空间，会把日式轻快民谣压成 `happy`，丢掉“朴素/民谣感”。

所以判据不是「覆盖率」，而是**保真度**。

### 14.4 可执行的判据：三元组保真测试

不需要“正确答案标签”，只需要你的相对判断：

1. 取 20–30 首你已知“该配哪类场景”的曲子；
2. 组三元组 `(A, B, C)`：A 与 B 应配**同一类**场景，C 应配**另一类**；
3. 在描述空间里算 `d(A,B) < d(A,C)` 成立的比例 = **triplet accuracy**。

阈值：**≥85% → 这个描述空间够用**，放心走两层架构；**<70% → 换描述层或补维度**（比如换带 instrument 轴的模型）。

这一步直接测「能不能支撑决策」，而不是「词像不像」——是本文里最该先做的一次性实验，成本约 1 小时。

### 14.5 一个反直觉结论

两层架构下，**「稳」比「准」重要**。一个 PR-AUC 只有 0.15 但有监督、输出稳定的打标器，配合一个能学系统偏差的决策层，可能比一个偶尔很准、但跨曲不可比的零样本更好用——因为**决策层能吸收系统偏差，吸收不了随机漂移**。

这也解释了为什么当前 `softmax` 必须去掉：它把“描述”耦合到“同批还有哪些概念”，既破坏了可比性，也破坏了「一次算好、永久复用」的前提。

### 14.6 对现有代码的直接含义

`analyze.py` 现在在分析层就做完 `softmax`（[analyze.py:165-166](../tools/tag/analyze.py)）。按两层架构应当改成：

- **分析层只输出原始相似度**（`audio @ concept_matrix.T` 的 29 个 cosine，或直接存音频向量），落盘缓存；
- **决策层**再做归一化、加权、与场景目标向量比对。

这样即使以后从 CLAP 换成有监督 tagger，决策层的权重与回归测试都不必重写。

---

## 15. 如果「氛围优先、织体不重要」：架构再简化一步

> 用户判断：对大多数模组场景，氛围（欢快 / 温馨 / 紧张）比编制（钢琴还是鼓点）重要；日式摇滚还是美式民谣也不重要。
>
> **接受这个前提，§14.3 的「必须保住织体区分」不再成立**，判据要改成按氛围分组。但它同时推出三件事，两好一坏。

### 15.1 坏消息：任务变成了标准 MER，而标准 MER 正是最弱的一环

氛围识别 = 音乐情绪识别。它的公开天花板：MTG-Jamendo mood/theme **PR-AUC 0.13–0.15**；MuChoMusic mood 维度最好的模型 **51.4%**（四选一，随机 25%）。**你需要的恰好是学界做得最不准的那件事**，不要期待开箱即用。

缓和一点：0.13–0.15 是 **59 类 macro 平均**，被长尾和类别不平衡拉低；你真正的任务是「一个小候选池内排序」，比 macro AP 容易得多。两者不能互相替代，但也不该被那个数字吓住——**要测的是池内排序，不是全网 AP**。

### 15.2 好消息：词表问题基本消失，但剩两个真实缺口

实测 Jamendo mood/theme 标签表（[moodtheme.txt](https://raw.githubusercontent.com/MTG/mtg-jamendo-dataset/master/data/tags/moodtheme.txt)，**59 个**，不是常说的 56）：

| 你的需求 | Jamendo 是否有 | 备注 |
|---|---|---|
| 欢快 | ✅ `happy` `upbeat` `fun` `party` | 覆盖充足 |
| 恐怖 | ✅ `horror` `dark` | 覆盖充足 |
| 忧伤 | ✅ `sad` `melancholic` | 覆盖充足 |
| 史诗 / 庄严 | ⚠️ `epic` `dramatic` `powerful` | 「庄严/肃穆」没有直接项 |
| **温馨** | ❌ **无** | 最接近 `hopeful` `soft` `mellow` `romantic` `love` |
| **紧张** | ❌ **无 `tense`** | 最接近 `dramatic` `dark` `heavy` |

**「温馨」和「紧张」恰好是 TRPG 最常用的两类氛围，却正好是通用词表的缺口。** 所以自定义词表仍然需要——但只需要补 2–5 个词，不是 29 个。这是本次调研里对「要不要自定义词表」最精确的回答。

### 15.3 最贴合的形态：V/A 两轴 + 少量氛围词

`cues.json` 的 `tags` 本来就是 V/A 网格（`valence: bright/neutral/dark` × `energy: static/building/driving/burst`）。氛围优先时，描述层最理想的输出就是这两个轴：

```
描述层：valence (1–9) + arousal/energy (1–9) [+ 可选：温馨/紧张等 2–5 个氛围词概率]
决策层：场景 → 目标 V/A 区间 + 氛围词权重 → 距离打分
```

好处：连续、跨曲可比、可缓存、可解释，**且与你已有 schema 同构**，不需要引入新的标签体系。

**怎么拿 V/A，三条路（按贴合度）**：

| 方案 | 成本 | 贴合度 | 备注 |
|---|---|---|---|
| **自己标 100 首训 ridge/MLP** | 标注约 0.5 小时，训练秒级 | 最高（贴合你的曲库与口味） | 只需要判断「偏明/偏暗、偏静/偏动」，是全人类共识度最高的标注 |
| Replicate `mtg/music-arousal-valence` | ¥0.016/首 | 中（别人的曲库） | 现成，但要出境、CC BY-NC-SA |
| music2emo 本地 | 独立环境 | 中 | 需和弦解析，Windows 未实测 |

**V/A 标注之所以便宜**：它不需要你判断 29 个概念，只需要两个方向；而人类对 valence/arousal 的一致性远高于对 56 个情绪词的一致性。

### 15.4 结构性建议：把织体从「打分轴」降级为「过滤器」

现在 29 个概念（含织体）在**同一个 softmax 里竞争**，所以一个要「轻快」的 cue 可能被「打击乐」赢走——这正是 §2 说的结构错配。

改为：

- **软轴（氛围 / V-A）负责排序**；
- **织体只在场景明说时做硬过滤**（cue 写了「军鼓」「圣咏」「钢琴」才启用 `tag.texture`）；
- 两者**不要混进同一个 softmax**。

这样已有的 29 词表不白做，但它不再污染主分数。

### 15.5 判据更新

§14.4 的三元组测试改为**按氛围分组**（同一类氛围 vs 不同类氛围），不按织体分组。因为氛围区分比织体粗，阈值可以更严：**≥90% 才算描述层够用**。

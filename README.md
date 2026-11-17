<div align="center">

# dsh-bgm-prep

**在对话里把模组拆成曲目表，在工作台里试听定选，最后一键落成网易云歌单。**

DeepSeek Harness 插件 · 跑团（TRPG）备团配乐

`MIT` · `Node ≥ 20` · `DSH ≥ 0.2.0-rc.1`

</div>

---

备团时真正耗时的不是"找一首 BGM"，而是"给三十个场景各配一首，并且记住哪首配哪段"。

这个插件把这件事做成一条有状态的流水线：

```
模组原文  →  分段清单  →  每段 8 首候选  →  试听 / 听感分析 / 段内得分  →  定选  →  网易云歌单 + 三份文档
```

曲目表是一份普通 JSON，跟着模组文件走，可以手改，也可以随时回到工作台继续。

---

## 它做什么

| 能力 | 说明 |
|---|---|
| **拆段** | 读取模组，切成演出顺序的段落：场景、触发点、明暗 / 能量 / 织体 / 有无歌词 / 张力 |
| **检索候选** | 每段 8 首。**歌单优先**：先命中策展歌单，再补歌曲检索——比关键词硬搜靠谱得多 |
| **听感分析** | 本地 music2emo 听整曲，给出 56 个 Jamendo 情绪原词的概率与 V/A，按本段目标权重算**段内得分** |
| **内嵌工作台** | 试听、拖动进度、定选、改场景、单段重搜，写回同一份 `cues.json` |
| **落地** | 新建或复用歌单（`日期-模组-BGM`），导出 `review.md` / `playlist.txt` / `playlist.csv` |
| **历史** | 每次建过的歌单都在工作台「历史」里，可回到那份表继续改 |

---

## 为什么不是"直接搜歌"

网易云的歌曲搜索对「压抑」「地城」「不协和」这类意图几乎无效——返回的是流行歌。

所以检索策略是：

1. **先找歌单**：用短查询词命中策展歌单（《恐怖纯音乐》《1920年代爵士》《管风琴圣咏》…）
2. **再从歌单里取曲目**：这些曲子已经被某个人按主题筛过一遍
3. **歌曲搜索只作补充**

一句话：**靠人的策展，不靠算法的语义理解。**

---

## 安装

```bash
git clone https://github.com/fengnowuyu-beep/dsh-bgm-prep.git
cd dsh-bgm-prep
npm install          # 只为一个依赖：qrcode（渲染登录二维码）
```

然后在 DSH 的 profile 里注册（profile 目录通常是 `~/.dsh/profiles/desktop`）：

```bash
pnpm add link:/绝对/路径/dsh-bgm-prep
```

或直接在该目录 `package.json` 的 `dependencies` 里加一行：

```json
"dsh-bgm-prep": "link:E:/path/to/dsh-bgm-prep"
```

重启 DSH，在「插件」列表里启用。侧边栏会出现「配乐工作台」。

---

## 一次性配置

### 必需：登录 `ncm-cli`

搜索、读歌单、建歌单都走 `ncm-cli`（开放平台的 `search/song` 等接口返回 `300 应用未授权`，
是应用权限包决定的，登录也解决不了）。

```bash
node scripts/setup.mjs --cli-login    # 打印一个链接，点开确认
node scripts/setup.mjs --check
```

### 可选：开放平台凭据

只用于账号资料与诊断，不影响主流程：

```bash
node scripts/setup.mjs --app-id <AppID> --private-key <PrivateKey>
```

### 可选：网易云登录（会员曲试听）

工作台右上角「播放设置」→「登录网易云」→ 手机扫码。**必须登录**才能播放会员曲：

| 存的凭据 | 结果 |
|---|---|
| 只有 `MUSIC_U` | 取到的是降级直链，落到 CDN **403** |
| 完整 cookie 串（含 `__csrf`） | 直链可用，实测能取到无损音源 |

勾选「从 Chrome 同步」可以一键抓取本机浏览器里已有的登录态（只读，不动 `User Data`）。

### 可选：听感分析

需要本机装好 music2emo（见下文「听感分析」）。没有也能用，只是没有机器排序。

---

## 工作流

1. **对话里给料**：把模组丢进对话，说一句「配乐」
2. **agent 出清单**：拆场景 → 建表 → 检索 → 输出规则化的曲目表
3. **它喊你去挑**：工具输出固定以「→ 请到侧边栏「配乐工作台」挑歌」结尾
4. **你在工作台定选**：试听、看自动标签与匹配度、点「选它」
5. **回对话收尾**：说「选完了」，agent 建歌单、导出文档
6. **回溯**：工作台「历史」里能看到每次建过的歌单

对话与工作台改的是**同一份文件**，不存在"两套数据"。

---

## 工具

插件向 agent 暴露 6 个工具：

| 工具 | 作用 |
|---|---|
| `bgm_init` | 建表 / 追加段 / 局部改段（`create` / `append` / `patch` / `replace`） |
| `bgm_fetch` | 为指定段检索候选，单次最多 8 段 |
| `bgm_pick` | 定选主选 + 备选；`song_id` 必须来自该段候选，否则整条拒绝 |
| `bgm_view` | 只读查看（`cues` 看场景切分，`full` 看选曲） |
| `bgm_commit` | 建歌单 + 导出三份文件；支持 `dry_run` |
| `bgm_tag` | 听感分析：56 个原生标签概率 + V/A + 段内得分 |

设计约束：**agent 做判断，插件做检索、校验、落盘**。工具不替你决定"这段该配什么"，
但会拒绝一切幻觉出来的 `song_id`。

---

## 工作台

侧边栏「配乐工作台」是一个嵌在主内容区的页面（和「用量」面板同一形态，不开弹窗、不遮罩）。

- **左栏**：段落列表，绿点=已选，红点=候选不足，空心=本段不配乐
- **右栏**：当前段的候选，按**匹配度**排序；低于 0.2 的整行变暗（信息保留，不隐藏）
- **每首候选显示**：`自动 恐怖配乐 0.87` · `匹配 0.42` · `人声 0.90`（≥0.6 标红）
- **底部播放条**：播放/暂停、可拖动进度
- **顶部**：分析听感、检索全部、导出文档、建歌单、历史、播放设置

### 歌单历史

每次建歌单自动记一条（模组 / 第几回 / 曲目数 / 歌单名 / 日期）。可以：

- **打开** → 回到那份曲目表继续改
- **在 App** → `orpheus://playlist/...` 直接跳网易云

---

## 听感分析（music2emo）

用 [music2emo](https://huggingface.co/amaai-lab/music2emo)（MERT + 线性头，MTG-Jamendo 上训练）给候选曲打分：
输出 **56 个 Jamendo 情绪原词的 sigmoid 概率** + valence/arousal。没有也能用，只是没有机器排序。

装到 E 盘（约 3 GB，独立 venv，别碰别处的环境）：

```powershell
E:\Software\Python310\python.exe -m venv E:\Software\audioml-m2e
$env:PIP_CACHE_DIR='E:\Software\audioml-m2e\pip-cache'
$env:HTTP_PROXY='http://127.0.0.1:7897'; $env:HTTPS_PROXY='http://127.0.0.1:7897'
E:\Software\audioml-m2e\Scripts\pip install torch==2.3.1 torchaudio==2.3.1 --index-url https://download.pytorch.org/whl/cpu
E:\Software\audioml-m2e\Scripts\pip install -r E:\Software\audioml-m2e\requirements.clean.txt
# requirements.clean.txt = 上游 requirements 去掉重复的 PyYAML、numpy 钉到 1.26.4，另补 mir_eval / pretty_midi
```

代码与权重：

```powershell
huggingface-cli download amaai-lab/music2emo --local-dir E:\Software\audioml-m2e\music2emo
huggingface-cli download m-a-p/MERT-v1-95M --local-dir E:\Software\audioml-m2e\models\MERT-v1-95M
```

上游代码需要三处小补丁（CPU 机器与插件集成必须）：`import gradio` 改可选、`torch.load(btc)` 加
`map_location`、`predict` 返回值带上完整 `probs`；MERT 路径读 `MERT_MODEL` 环境变量。

在 `$DSH_HOME/bgm-prep/settings.json` 里指过去：

```json
{
  "analysis": {
    "engine": "music2emo",
    "python": "E:\\Software\\audioml-m2e\\Scripts\\python.exe",
    "code": "E:\\Software\\audioml-m2e\\music2emo",
    "models": "E:\\Software\\audioml-m2e\\models"
  }
}
```

CPU 实测：模型加载 5 秒、单曲解码 7 秒、推理 25 秒；结果按歌缓存，同一首歌只算一次。

**它擅长**：判断实际气质（够不够 dark、是不是 epic、偏 sad 还是 happy）。
**它不擅长**：判得绝对准确（Jamendo 56 类 macro PR-AUC 0.15 是公开天花板），所以只用于段内排序。

### 怎么判断的

```
音频 → 24 kHz mono → 切 30 秒段 → BTC 和弦 + MERT 特征
     → J_all 头（56 个 Jamendo 情绪词）→ sigmoid 概率
     → D_all 头 → valence / arousal
     → 多段取平均 → 按歌缓存
```

- **没有 softmax**：每个标签的概率互相独立，加一个标签不会让别的分数漂。
- **没有二次映射**：段的目标直接写模型认识的原生标签（`dark` / `dramatic` / `calm`），
  打分就是 `Σ 权重 × 概率 / Σ 权重`。
- **只在段内排序**：得分是「按这段的权重算出来的」，跨段不可比。

> 模型的 56 个标签里**没有 `horror`**（Jamendo 59 里的 horror / mellow / ambiental 不在训练集）。
> 所以「恐怖」要落成 `dark + dramatic + heavy` 的组合，写 `horror` 会被词表校验过滤掉。

### 词表

默认就是模型的原生 56 个标签（安装时从 `inference/data/tag_list.npy` 抄出来，冻结在
`$DSH_HOME/bgm-prep/moods.json`）。**不做中文转写、不做二次映射**：场景表上写什么词，模型就打什么分。

想在别处换一套词表，替换 `moods.json` 即可（结构 `{"version":"...","tags":["dark","calm",…]}`），
但必须是模型认识的那 56 个词——模型只输出这些。

---

## 输出在哪

全部在模组目录下的 `bgm/`：

```
<模组目录>/bgm/
    tianti.cues.json          曲目表（唯一真相，可手改）
    tianti.review.md          完整曲目表，给人看
    tianti.playlist.txt       每行「曲名 - 艺人」
    tianti.playlist.csv       含 song_id，UTF-8 BOM，Excel 直接开
    tianti.cues.json.bak-*    每次写入前的备份（保留 3 份）
```

---

## 参数

编辑 `$DSH_HOME/bgm-prep/settings.json`（不存在就自己建）：

```json
{
  "seedPlaylists": [3778678, 1234567],
  "candidateLimit": 8,
  "fetchBudget": 200
}
```

| 字段 | 作用 |
|---|---|
| `seedPlaylists` | 种子歌单 id。留空时自动挑选：名字含模组名的那张 + 名字带 `bgm` 的大池子 |
| `candidateLimit` | 每段保留几首候选，默认 8 |
| `fetchBudget` | 单次 `bgm_fetch` 最多调几次接口，默认 200 |

自动挑种子时会跳过名字含「华语 / 日系 / ACG / 其他 / 喜欢」的歌单——那些通常不是跑团向的。

---

## 已知限制

诚实清单：

- **不是语义搜索**。效果高度依赖你的策展歌单质量；找不到对味的歌，加种子歌单比换关键词更有效。
- **会员曲依赖登录态**。没登录只能听 30 秒试听或拿不到直链；登录后走 weapi 取签名直链。
- **听感分析是概率，不是判决**：56 类 macro PR-AUC 的公开天花板在 0.15 量级，只用于段内排序。
- **匹配度只用于段内排序**，跨段不可比。
- **不做开团播放**。工作台是备团期的试听工具，开团请用你自己的播放器。
- **歌词、均衡器、多平台**都不在范围内——这是配乐准备工具，不是音乐播放器。

---

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| `[301] 用户未授权` | 没登录或 token 过期 | `node scripts/setup.mjs --login` |
| `[300] 应用未授权` | 接口不在应用权限包里 | 换接口；`search/song` 就是这样 |
| `候选不足` | 种子歌单太少或关键词没命中 | 加 `seedPlaylists`，或把 `tags` 写具体些 |
| 会员曲放不了 | 只存了 `MUSIC_U` | 工作台「播放设置」重新扫码，存完整 cookie |
| 提示「拿不到音频」 | 未登录 / 该曲地区受限 | 先登录；或接受该首没有分析结果 |
| 中文乱码 | 终端代码页 | `chcp 65001` |

---

## 目录结构

```
dsh-bgm-prep/
  lib/
    index.js        6 个工具的实现与注册
    ui.js           工作台 Host 侧：状态、路由、音频直链
    client.js       工作台前端（React，通过 ModuleLoader 加载）
    ncm.js          ncm-cli 通道 + 开放平台 HTTP
    netease.js      weapi 签名、播放直链、扫码登录
    cookie.js       凭据存取、验证、从 Chrome 只读同步
    search.js       歌单优先的检索策略
    filter.js       归一化、去噪、去重、打分
    store.js        曲目表读写、校验、派生状态
    format.js       三种导出格式
    tag.js          （保留）CLAP 兜底：换直链、起 Python
    match.js        （保留）旧的中文概念映射，仅 CLAP 兜底用
  tools/m2e/analyze.py   music2emo 推理（Python 侧）
  tools/tag/analyze.py   （保留）CLAP 推理
  scripts/setup.mjs      凭据 / 登录 / 自检
  test/                  单元测试
  docs/                  交互协议与设计记录
```

---

## 开发

```bash
npm test        # 纯逻辑测试，不需要网络和登录
```

凭据与登录态都存在 `$DSH_HOME/bgm-prep/`，**不在仓库里**。提交前请确认没有把
`settings.json`、`cookie`、`credentials.json` 带进来。

---

## License

[MIT](LICENSE)

用到的第三方资源：`qrcode`（MIT）、music2emo（代码 Apache-2.0；MERT 权重 CC BY-NC 4.0，仅非商用）、CLAP（Apache-2.0，兜底）。
本项目不下载、不转存音频；直链由网易云接口即时签发，随会话过期。

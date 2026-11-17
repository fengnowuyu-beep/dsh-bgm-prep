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
模组原文  →  分段清单  →  每段 8 首候选  →  试听 / 打标 / 匹配度  →  定选  →  网易云歌单 + 三份文档
```

曲目表是一份普通 JSON，跟着模组文件走，可以手改，也可以随时回到工作台继续。

---

## 它做什么

| 能力 | 说明 |
|---|---|
| **拆段** | 读取模组，切成演出顺序的段落：场景、触发点、明暗 / 能量 / 织体 / 有无歌词 / 张力 |
| **检索候选** | 每段 8 首。**歌单优先**：先命中策展歌单，再补歌曲检索——比关键词硬搜靠谱得多 |
| **自动打标** | 本地 CLAP 模型听 30 秒，给出情绪标签、**人声概率**、以及**与本段需求的匹配度** |
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

### 可选：自动打标

需要本机有一套 Python + PyTorch 环境（见下文「自动打标」）。没有也能用，只是没有机器标签。

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
| `bgm_tag` | 自动打标：情绪 top3 + 人声概率 + 与本段的匹配度 |

设计约束：**agent 做判断，插件做检索、校验、落盘**。工具不替你决定"这段该配什么"，
但会拒绝一切幻觉出来的 `song_id`。

---

## 工作台

侧边栏「配乐工作台」是一个嵌在主内容区的页面（和「用量」面板同一形态，不开弹窗、不遮罩）。

- **左栏**：段落列表，绿点=已选，红点=候选不足，空心=本段不配乐
- **右栏**：当前段的候选，按**匹配度**排序；低于 0.2 的整行变暗（信息保留，不隐藏）
- **每首候选显示**：`自动 恐怖配乐 0.87` · `匹配 0.42` · `人声 0.90`（≥0.6 标红）
- **底部播放条**：播放/暂停、可拖动进度
- **顶部**：自动打标、检索全部、导出文档、建歌单、历史、播放设置

### 歌单历史

每次建歌单自动记一条（模组 / 第几回 / 曲目数 / 歌单名 / 日期）。可以：

- **打开** → 回到那份曲目表继续改
- **在 App** → `orpheus://playlist/...` 直接跳网易云

---

## 自动打标（可选）

用 [CLAP](https://github.com/LAION-AI/CLAP) 零样本给候选曲打分。**这台机器上需要一个独立的 Python 环境**：

```bash
python -m venv <env>
<env>/Scripts/python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
<env>/Scripts/python -m pip install transformers librosa soundfile
```

然后在 `$DSH_HOME/bgm-prep/settings.json` 里指过去：

```json
{
  "tagger": {
    "python": "E:\\Software\\Python310\\python.exe",
    "sitePackages": "E:\\Software\\audioml\\.venv\\Lib\\site-packages",
    "hfHome": "E:\\Software\\audioml\\models",
    "proxy": "http://127.0.0.1:7897"
  }
}
```

> `python` 用**基础解释器**、虚拟环境只通过 `sitePackages` 挂进来，是有意为之：
> venv 里的 `python.exe` 在部分环境（含本机的 DSH 沙箱）只被允许写工作区，
> 而模型缓存和临时文件在别处。这样写可以绕开那个限制。

模型首次使用会从 HuggingFace 下载约 1.2GB。走代理时 `proxy` 必须带 `http://` 前缀，
否则 urllib 会把它当成 HTTPS 代理，报 `check_hostname requires server_hostname`。

**它擅长**：判断实际气质（是不是恐怖、是不是安静钢琴、有没有人声）。
**它不擅长**：好不好听、配不配这段戏——那还是人耳。

### 怎么判断的

```
音频 → 开头/中间/结尾各 20 秒 → 三个向量取平均
词表 → 每个概念 3–5 个英文说法 → 向量取平均
两者算余弦相似度 × 温度 27.4 → softmax → 这一批概念上的分布
```

两个设计决定是被实测逼出来的：

- **多窗口**：只听中间 30 秒会撞上间奏，一首轻快的曲子可能因此被判成安静。
- **一个概念多个说法**：《ひやむぎ、そーめん、时々うどん》在单句 `feel-good upbeat music` 下
  「轻快」只有 **0.02**；换成 5 句平均后升到 **0.36+**，同样的模型、同样的音频。

匹配度是按**这一段自己的期望词表**算的（`lib/match.js`），所以**跨段的分数不可比较**，只用于段内排序。

### 自定义词表

默认词表在 `lib/vocabulary.js`（30 个概念）。想改就把同结构文件放到
`$DSH_HOME/bgm-prep/vocabulary.json`——**同名的 label 会替换默认 prompts**，不会删掉其它概念。
模板见 [`docs/vocabulary.example.json`](docs/vocabulary.example.json)。

```json
[
  { "label": "活泼器乐", "prompts": ["cheerful playful acoustic guitar", "bouncy light-hearted folk tune"] }
]
```

> 写 prompt 的窍门：同一个概念要覆盖**不同语感**（乐器组合、节奏感、年代），
> 而不是写三句同义词。模型是在文本空间里找邻域，同义词扩不出邻域。

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
- **自动打标是概率**，不是判决。人声概率 0.5 左右的民谣容易被低估（30 秒中段可能刚好没唱）。
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
| 打标提示「拿不到音频」 | 未登录 / 该曲地区受限 | 先登录；或接受该首没有标签 |
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
    tag.js          自动打标（Node 侧：换直链、起 Python）
    match.js        每段的期望词表与匹配度分档
  tools/tag/analyze.py   CLAP 推理（Python 侧）
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

用到的第三方资源：`qrcode`（MIT）、CLAP 模型（`laion/larger_clap_music_and_speech`，按上游许可使用）。
本项目不下载、不转存音频；直链由网易云接口即时签发，随会话过期。

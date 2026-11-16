# 跑团配乐·备团（`dsh-bgm-prep`）

把模组里的场景变成一份**曲目表**：每段选一首主用曲 + 若干备选，最后导出成能照着建的歌单清单。

- 不下载音频、不播放、不碰你的账号数据（除了读歌单）
- 曲目表是普通 JSON，跟着模组文件走，可以手改
- 判断（切场景、打标签、选曲）由 agent 做；插件只做检索、校验、落盘

---

## 一次性配置（三分钟）

需要在 `$DSH_HOME/bgm-prep/credentials.json` 里有开放平台的 AppID + PrivateKey。

```powershell
# 1. 写入凭据（在插件目录下执行）
node scripts/setup.mjs --app-id <你的 AppID> --private-key <你的 PrivateKey>

# 2. 登录 ncm-cli（搜歌、读歌单、建歌单都靠它，会打印一个链接）
node scripts/setup.mjs --cli-login

# 3. 自检
node scripts/setup.mjs --check
```

`--check` 应该看到：

```
凭据: 已配置 appId=b3010d...
登录: ✅ 用户已登录  accessToken=...
CLI 登录: ✅ ncm-cli 已登录
```

> **为什么要登录两次**：`ncm-cli` 有自己的登录态（加密存在 `~/.config/ncm-cli/`），
> 而开放平台 HTTP 接口要的是另一份 accessToken。插件的数据操作全走 CLI，
> HTTP 那份只用于账号资料和诊断。
>
> **为什么搜歌必须走 CLI**：开放平台的 `search/song`、`playlist/song/list` 都返回
> `300 应用未授权`（应用权限包决定的，登录也解决不了）；而 `ncm-cli` 登录后会注册
> 一整套动态命令（search / playlist / album / recommend…），走的是另一套授权，实测可用。

---

## 最短使用路径

1. 把模组原文贴进对话，或说「用第三幕配乐」
2. 说一句「**第三幕配一下**」
3. 看表 → 说「可以」→ 拿 `playlist.txt` 去建歌单

### 自动打标（可选）

机器听 30 秒音频，给每首候选补两样东西：**情绪标签**和**有没有人声**。

- 工具：`bgm_tag`；工作台：顶部「自动打标」（全部）或单段的「打标」
- 显示：`自动 恐怖配乐 0.87 · 人声 0.90`，人声 ≥0.6 标红，top1 与 top2 差距 <0.1 时显示「不确定」

**它擅长什么**：判断曲子的实际气质（是不是恐怖、是不是安静钢琴、是不是律动），以及**有没有人声**——后者是跑团 BGM 的硬指标。
**它不擅长什么**：好不好听、配不配这段戏。那还是得你听。

依赖是可复用环境，不在插件目录里：

```
E:\Software\audioml\      torch 2.14.1+cpu、transformers、librosa、CLAP 模型
```

路径可用 `$DSH_HOME/bgm-prep/settings.json` 覆盖：

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

> 会员曲没有 `MUSIC_U` 拿不到音频，这类候选会记一条 `拿不到音频`，不影响其它曲目。

## 工作台（侧边栏「配乐工作台」）

一个完整的备团流程，不只是一个只读页面：

1. **打开 / 新建**：顶部「新建曲目表」填模组名 + 目录 + 回数 + 范围，会在 `<目录>/bgm/<范围>.cues.json` 建表；也可以从「最近」里打开旧表。
2. **编场景**：右栏「编辑」改场景名和触发句；左栏底部「+ 加一段」；编辑态里可「删除本段」。
3. **检索候选**：顶部「检索全部」或右栏「找候选」（已有候选时是强制重跑）。一次最多处理 8 段，界面会自动续跑。
4. **试听与定选**：每首候选左边是试听，右边「选它」；选中后显示理由，并在左栏打绿点。
5. **标不配乐**：右栏底部「标为不配乐」，该段从歌单里消失但保留在表里。
6. **建歌单**：顶部「建歌单」先弹预览（歌单名 / 新增几首 / 还有哪些段没选），确认后才写账号。
7. **导出文档**：写 `review.md` / `playlist.txt` / `playlist.csv`。

**返回**：左上角「← 返回对话」。

### 播放设置（会员曲必看）

**不用手抄 cookie，也不用开浏览器**：右上角「🔈 播放设置」→「登录网易云」→ 面板里直接出二维码，
手机网易云 App 扫码 → 自动保存并验证。

关键不是"有没有登录"，而是**存了什么**：

| 存的东西 | 结果 |
|---|---|
| 只有 `MUSIC_U` | 拿到的播放直链是降级的，落地 CDN **403** |
| 完整 cookie 串（含 `__csrf`） | 直链可用，会员曲 **200**，实测拿到 22MB 无损音频 |

所以插件现在存的是**整串 cookie**（`settings.json` 的 `musicCookie`），取链时还会把 `__csrf`
作为 `csrf_token` 一起送进 weapi。旧版本只存了 `MUSIC_U` 的，读取时仍然兼容，但重新登录一次才会升级。

想换或想清，对话框里都有按钮；也可以从 Chrome 一键同步整个 `music.163.com` 的 cookie 罐（只读，不碰浏览器数据文件）。

---

## 输出在哪

全部在模组目录下的 `bgm/`：

```
<模组目录>/bgm/
    s3-act3.cues.json        曲目表（唯一真相，可手改）
    s3-act3.review.md        完整曲目表，给人看
    s3-act3.playlist.txt     每行「曲名 - 艺人」
    s3-act3.playlist.csv    含 song_id，UTF-8 BOM，Excel 直接开
    s3-act3.cues.json.bak-*  每次写入前的备份（保留 3 份）
```

---

## 怎么改参数

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
| `seedPlaylists` | 种子歌单 id。**留空时会自动从你自己的歌单里挑**：名字含模组名的那张 + 名字带 BGM 的大池子 |
| `candidateLimit` | 每段保留几首候选，默认 8 |
| `fetchBudget` | 单次 `bgm_fetch` 最多调几次接口，默认 200 |

自动挑种子的规则（`seedPlaylists` 为空时生效）：

1. 名字里包含当前模组名的歌单（通常是你之前为这个模组整理过的那张）→ 1 张
2. 名字里带 `bgm` 的歌单，按曲目数从多到少 → 1 张
3. 名字含「华语 / 日系 / ACG / 其他 / 喜欢」的跳过

想锁定某几张就填 `seedPlaylists`，填了就不再自动挑。

歌单 id 从分享链接里看：`https://music.163.com/playlist?id=3778678` → `3778678`。

---

## 出错时先看什么

| 现象 | 原因 | 处理 |
|---|---|---|
| `[301] 用户未授权` | 没登录或 token 过期 | `node scripts/setup.mjs --login` |
| `[300] 应用未授权` | 该接口没在应用权限包里 | 换接口；`search/song` 就是这样 |
| `[2511] 缺少 clientIp` | 拿不到出口 IP | 检查网络/代理 |
| `候选不足` | 种子歌单太少或关键词没命中 | 加 `seedPlaylists`，或把该段的 `tags` 写具体些 |
| 表里编号对不上 | 报的是 `c0x` 还是「第 k 段」 | 只认「第 k 段」，`c0x` 只在文件里 |
| 中文乱码 | 终端代码页 | 先 `chcp 65001` |

---

## 已知限制

- **两条通道**：搜歌/读歌单/建歌单走 `ncm-cli`（动态命令），账号资料与诊断走开放平台 HTTP。CLI 未登录时数据操作会明确报 `cli-not-logged-in`。
- **不能按"氛围"精确搜**：网易云的关键词召回对「压抑」「地城」这类意图不友好，所以检索策略是**歌单优先 + 短查询词**；效果依赖策展歌单，不是语义搜索。
- **判不了前奏静音**：不下载音频，`intro_unknown` 只是占位，需要你听 5 秒确认。
- **判不了有没有人声**：元数据里 `vocalFlag` 常为 null，只能靠标题/专辑名规则猜。
- **不做播放**：本期只做备团，开团时用你自己的播放器。
- 单段检索约 3~5 次接口调用；4 段约 12 次、35 秒。

---

## 卸载

1. 在插件列表里禁用或移除 `dsh-bgm-prep`
2. `$DSH_HOME/bgm-prep/` 可以整个删掉（里面是凭据、token、缓存）
3. `<模组目录>/bgm/` 是你的数据，**删除插件不会动它**，想留就留着
4. 网易云控制台里撤销该应用的 AppID/PrivateKey（如果不再用）

---

## 目录结构

```
dsh-bgm-prep/
  package.json / cordis.patch.yml   插件清单
  lib/index.js                      5 个工具
  lib/ncm.js                        开放平台 HTTP 适配层（唯一涉及签名的地方）
  lib/store.js                      曲目表读写、校验、派生状态
  lib/search.js                     歌单检索与缓存
  lib/filter.js                     归一化、去噪、去重、打分
  lib/format.js                     两种表的版式
  docs/WORKFLOW.md                  ★ 交互协议与提取规则（要改行为改这里）
  docs/DETAIL.md                    插件详情页
  scripts/setup.mjs                 凭据 / 扫码登录 / 自检
  tools/                            开发期探针（spike 留下的，可删）
  test/                             单元测试
```

---

## 开发

```powershell
npm test        # 纯逻辑测试，不需要网络和登录
```

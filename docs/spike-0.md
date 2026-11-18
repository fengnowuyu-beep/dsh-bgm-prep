# 阶段 0 spike 报告（结论版）

> 2026-11-16 · 全部为本机实测，未修改用户账号数据
> **状态：历史快照**。接口行为会变（例如 CLI 通道后来上线、检索改成「歌单为主 + 搜歌补充」），
> 现状以 `lib/ncm.js` / `lib/search.js` 与最新实测为准。

## 一、最终结论

| 问题 | 结论 |
|---|---|
| `ncm-cli` 能用吗 | **只做登录/播放/云盘**。没有搜索、没有歌单写入。 |
| 检索走哪条路 | **C 路线：直连开放平台 HTTP**，已完成签名、设备、匿名 token 全链路实测 |
| 能按关键词搜歌吗 | **不能**。`search/song/get/v2` 返回 `300 应用未授权`，登录也解决不了 |
| 能建歌单吗 | **不能**。`playlist/create`、`playlist/tracks/add` 等 7 条候选路径全部 404 |
| 那还能做什么 | 搜**歌单** → 读歌单曲目 → 筛曲 → 导出清单，由用户手动建歌单 |

---

## 二、`ncm-cli` 实测

| 项 | 结果 |
|---|---|
| 安装 | 装进 `$DSH_HOME/bgm-prep/vendor`，74 包，2 MB，**未污染全局** |
| 运行 | 托管 node v24.21.0 + `dist/index.js`，`shell:false`，绕开 `spawn('npm.cmd')` 的 EINVAL |
| `--version` | ✅ 0.1.7 |
| `--help` / 大部分命令 | ⚠️ 未配凭证前被拦截（exit 1）；`config set` 可用 |
| 输出格式 | ⭐ `--output` 默认就是 `json` |
| 凭证落盘 | ⭐ `~/.config/ncm-cli/credentials.enc.json`，`{iv,data}` **AES 加密**，非明文 |
| 静态命令 | `play/pause/queue/state/login/logout/tui/configure/config/cloudupload/cloud/diag` |
| 关键字统计 | `search` **0 次**、`createPlaylist` **0 次**、`addTrack` **0 次** |

---

## 三、开放平台 HTTP（C 路线）

### 域名不是文档上那个

文档写 `openapi.music.163.com`，**实际是 `openncm.music.163.com`**。用前者的结果全部是「接口未找到」。

### 签名（已破解并验证）

钩住 CLI 的 fetch 抓到真实请求，再用抓到的参数在本地反推，命中：

```
canonical = 参数按键名升序 → "k=v" 用 & 连接（值不编码）
sign      = RSA-SHA256(canonical, privateKey) → base64
```

### 设备参数（平台会校验格式）

必须是 JSON 字符串，且下列值要"符合约定"（实测只有这组能过）：

```json
{"deviceType":"openapi","os":"ncmcli","appVer":"0.1.7","channel":"ncmcli",
 "model":"Windows_x64_cli","brand":"ncmcli","osVer":"<os.release()>",
 "clientIp":"<出口 IP>","deviceId":"ncmcli_<hex>"}
```

缺 `clientIp` → `2511`；缺 `device` → `2510`；`os/channel/brand` 不合约定 → `400 公共参数校验失败`。

### 传参方式

- 业务接口：`GET`，参数在查询串
- 匿名登录：`POST`，JSON body，`bizContent = {"clientId":"<appId>"}`

### 已确认的接口

| 接口 | 状态（匿名） | 含义 |
|---|---|---|
| `POST /oauth2/login/anonymous` | 200 | 拿匿名 token（有效期 86400s） |
| `GET /user/oauth2/qrcodekey/get/v2` | 200 | 扫码登录用 |
| `GET /oauth2/device/login/qrcode/get` | 200 | 轮询扫码状态 |
| `GET /user/profile/get/v2` | 301 | 用户资料 |
| `GET /search/playlist/get/v2` | 301 | **搜歌单** |
| `GET /search/album/get/v2` | 301 | 搜专辑 |
| `GET /playlist/detail/get/v2` | 301 | **歌单详情（含曲目）** |
| `GET /song/detail/get/v2` | 301 | 歌曲详情 |
| `GET /search/song/get/v2` | **300** | ❌ 应用未授权 |
| `GET /search/artists/get/v2` | **300** | ❌ |
| `GET /toplist/get/v2` | **300** | ❌ |
| `GET /recommend/playlist/get` | **300** | ❌ |
| `GET /similar/song/list/get/v2` | **300** | ❌ |
| `GET /playlist/song/list/get/v2` | **300** | ❌ |
| 歌单创建/加曲（7 条候选路径） | **404** | ❌ 不存在 |

> `301` = 存在但需要用户登录；登录后预计变 200（**待验证**）。
> `300` = 应用级未授权，改不了。

### 错误码对照

| 码 | 含义 |
|---|---|
| 300 | 应用未授权当前接口 |
| 301 | 用户未授权（未登录） |
| 400 | 公共参数校验失败 |
| 1402 | 非法 sign |
| 1406/1407/1408 | token 过期 / 失效 |
| 2509 | 缺少 accessToken |
| 2510 / 2511 / 2512 | 缺少 device / clientIp / sign |
| -444 / -445 / -446 | 限流 |

---

## 四、对设计的影响

1. **`lib/ncm.js` 改成 HTTP 实现**（原设计的"A 路线包 CLI"作废）。
2. **检索以歌单为单元**，`buildQueries` 生成歌单关键词，而不是歌曲关键词。
3. **`bgm_commit` 不写账号**，只导出 `review.md` / `playlist.txt` / `playlist.csv`；最后一步手动建歌单（约 3 分钟）。
4. **必须扫一次码**：所有有用的读接口都是 301。

---

## 五、登录后的实测（2026-11-16 04:40）

登录成功，账号「枫色物语」。token 落盘后发现 803 返回里 `accessToken` 是**嵌套对象**（`{accessToken,refreshToken,expireTime}`），不是字符串——已修。

### 能用的接口

| 接口 | 参数 | 返回 |
|---|---|---|
| `search/playlist/get/v2` | `{keyword, limit, offset}` | `{recordCount, records[]}`，每条含 `id`(32位hex) / `originalId`(数字) / `name` / `trackCount` / `describe` / `tags` / `jumpUrl` |
| `search/album/get/v2` | `{keyword, limit, offset}` | 同上形状，reocrds 为专辑 |
| `playlist/detail/get/v2` | `{playlistId: "<32位hex>"}` | 歌单元信息（**无曲目**） |
| `album/detail/get/v2` | `{albumId: "<32位hex>"}` | 专辑元信息（**无曲目**） |
| `user/profile/get/v2` | `{}` | 用户资料 |

**id 的坑**：搜索返回的 `id` 是 32 位 hex，`originalId` 才是数字。`playlist/detail` 只认 **hex**；传数字会得到 `code:400 参数错误`，传错参数名会得到 HTTP 400 空 body。

### 被挡死的接口

| 接口 | 结果 |
|---|---|
| `search/song/get/v2` | 300 应用未授权（用户 token 也一样） |
| `playlist/song/list/get/v2` | 300 应用未授权 |
| `song/list/get/v2` | 300 应用未授权 |
| `song/detail/get/v2` | HTTP 400（参数名/类型不对，且没有歌曲 id 可试） |
| `search/suggest/keyword/get/v2` | 300 |
| `toplist` / `recommend` / `similar` / `artists` | 300 |

### 结论：拿不到任何一首歌的 id（**已被下一条推翻**）

歌单和专辑都只有**元信息**，没有曲目列表；能返回曲目的两个接口都在应用权限之外。

> ⚠️ **这一节的结论后来被推翻了**：开放的 HTTP 接口确实拿不到歌，但 `ncm-cli` 登录后会注册一整套动态命令，走的是另一套授权。见下一节。

### 补救：登录后 `ncm-cli` 的动态命令

`ncm-cli login` 成功后，`ncm-cli commands` 会多出几十个命令（未登录时完全看不到）。实测可用的关键几个：

| 命令 | 参数 | 用途 |
|---|---|---|
| `search song` | `--keyword --limit --offset` | **搜歌**，返回 `{recordCount, records[]}` |
| `search playlist` | `--keyword --limit` | 搜歌单 |
| `playlist tracks` | `--playlistId <32位hex> --limit --offset` | **读歌单曲目**，`data` 直接是数组 |
| `playlist created` | `--limit` | 我创建的歌单 |
| `playlist create` | `--playlistName` | **建歌单** |
| `playlist add` | `--playlistId --songIdList '["hex",…]'` | **加曲**（要加密 id） |
| `playlist remove` | 同上 | 删曲 |
| `album tracks` / `artist songs` / `recommend daily` / `song lyric` | — | 备用 |

曲目记录的字段：`originalId`（数字 id）、`id`（32 位加密 id，加歌单必须用它）、`name`、`duration`（毫秒）、`artists[].name`、`album.name`、`playFlag`（false = 不可播）。

**参数怎么查**：子命令的 `--help` 会回退到根帮助，要用 `ncm-cli <组> help <子命令>`，例如 `ncm-cli playlist help tracks`。

### 因此最终架构

- **数据类**（搜歌 / 读歌单 / 建歌单 / 加曲）→ 走 `ncm-cli` 动态命令，`spawn(node, [dist/index.js, ...])` + `--output json`
- **登录与账号资料** → 走开放平台 HTTP（自实现签名）
- 两条通道各有自己的登录态，互不影响

### 仍然未知

- 控制台能否追加接口权限（需用户登录控制台查看）
- `song/detail` 的正确参数名（拿到 song id 后才能验）


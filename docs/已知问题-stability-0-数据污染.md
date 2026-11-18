# 已知问题：`stability: 0` 历史数据污染（已清理）

> 记录日期：2026-11-18
> 状态：**已清理**（2026-11-18 23:14，100 条 → `null`，0 条残留）
> 相关：I2 的 `null → 0` 写入 bug

## 一、现象

曲目表里存在大量 `"stability": 0`，与之前修掉的 `"vocal": 0` 是**同一个 bug 的两个受害者**。

`vocal: 0` 已于 2026-11-18 08:42 清洗为 `null`（见 `docs/test-findings-2026-11-18.md` 的 I2 节「历史数据清洗」）。

`stability: 0` 按当时「只动 vocal」的要求**没有清理**，因此现在仍留在数据里。

## 二、判据（为什么这些 0 不是真测出来的）

与 `vocal` 完全一致，且已核对上游：

1. 写入路径的根因是 `Number.isFinite(Number(null)) === true`，`null` 会被写成 `0`；
2. `tools/m2e/analyze.py` 在拼结果时**硬编码** `"stability": None`（music2emo 的 `predict` 只返回
   probs / va / predicted_moods，没有 stability），所以写入端从来不产生数字；
3. 所有表里 `music2emo-v1` 的 stability 数字**清一色全是 0**，没有任何其它取值——真实测量不会长这样。

结论：**全部 100 条 0 都是 bug 产物，不存在「真实测出来的 0」**。

## 三、影响范围（2026-11-18 统计）

| 表 | `stability: 0` 条数 |
|---|---:|
| `F:\Data\听枫馆\模组\COC\028不夜城的苍白之颜\bgm\buyecheng-3scene.cues.json` | 22 |
| `test-runs\20261118-080859-border-post\border-post.cues.json` | 16 |
| `test-runs\20261118-080015-fog-lighthouse\fog-lighthouse.cues.json` | 16 |
| `E:\...\bgm-demo-3scenes\bgm\demo-3scenes.cues.json` | 14 |
| `F:\Data\听枫馆\模组\COC\028不夜城的苍白之颜\bgm\buyecheng.cues.json` | 8 |
| **合计** | **约 100 条** |

> 说明：这是 2026-11-18 的快照，之后新增的表可能还有。真正清理时应重新全盘扫描一遍
> （Everything 搜 `*.cues.json`，排除 `%TEMP%`、`node_modules`、`.git`）。

## 四、当前状态（已清理）

- **已清洗**：5 份曲目表共 **100 条** `stability: 0` 改成 `null`（2026-11-18 23:14）
- **未删除**：没有删任何记录；每份文件都留了 `*.bak-stability0-20261118-231448`
- **复查**：清洗后用同一套扫描（Everything 枚举 + 脚本过滤）复查，**0 条残留**
- **代码已修**：`finiteOrNull` 已上线，新写入不会再产生这个 0

## 五、为什么按「清洗为 null」处理

原候选方案里，「清洗为 null」需要先确认引擎是否真的输出过 stability。核对结果：
`tools/m2e/analyze.py` 在拼结果时**硬编码** `"stability": None`，music2emo 的 `predict`
只返回 probs / va / predicted_moods，没有 stability。所以这 100 条 0 全部是 bug 产物，
直接清成 `null` 是安全的（与 `vocal` 的清洗同一判据）。

## 六、怎么复查

```powershell
# 统计所有表里 stability = 0 的条数
Get-ChildItem -Path 'F:\Data\听枫馆','E:\Data\Project\DeepSeekHarness' -Recurse -Filter '*.cues.json' -ErrorAction SilentlyContinue |
  Select-String -Pattern '"stability"\s*:\s*0\b' -List |
  ForEach-Object { "$($_.Path) : $((Select-String -Path $_.Path -Pattern '"stability"\s*:\s*0\b').Count)" }
```

## 七、相关备份

- `C:\Users\Kaede\.dsh\bgm-prep\analysis.db.bak-20261118-084103`（vocal 清洗时留的库备份）
- 5 份曲目表的 `*.cues.json.bak-vocal0-20261118-084127`（vocal 清洗）
- **5 份曲目表的 `*.cues.json.bak-stability0-20261118-231448`（本次 stability 清洗）**

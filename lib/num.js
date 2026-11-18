// 数值清洗：把「缺失」和「零」分开。
//
// 常见坑：用 `Number.isFinite(Number(x))` 当守卫，`Number(null) === 0`、
// `Number('') === 0` 都会通过，于是「不知道」被悄悄写成 0（2026-11-18 实测：
// 读一次表就把 analysis.vocal 的 null 固化成 0）。

/**
 * 空值 → null；能转成有限数字 → 数字；其余 → null。
 * @param {unknown} value
 * @returns {number|null}
 */
export function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export default { finiteOrNull }

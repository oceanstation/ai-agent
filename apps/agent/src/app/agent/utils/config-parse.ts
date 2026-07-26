/**
 * 配置字符串解析工具。
 *
 * ConfigService.get<string>() 拿到的都是原始字符串（或 undefined）,
 * 这里集中处理"字符串 → boolean/number/string[]"的归一化与默认值回退,
 * 避免各 *.config.ts 里重复实现。
 */

/**
 * 把字符串解析成布尔值。
 *
 * - `'true' | '1' | 'yes'` → `true`（大小写不敏感、自动 trim）
 * - `'false' | '0' | 'no'` → `false`
 * - 其它值（含 `undefined` / 无法识别）→ `fallback`
 */
export function parseBool(
  v: string | undefined,
  fallback: boolean,
): boolean {
  if (v == null) return fallback;
  const s = v.trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return fallback;
}

/**
 * 把字符串解析成正整数（> 0）。
 *
 * 非法值（空串、NaN、≤ 0）会回退到 `fallback`。
 */
export function parseIntSafe(
  v: string | undefined,
  fallback: number,
): number {
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * 把英文逗号分隔的字符串解析成字符串数组，自动 trim + 去空。
 *
 * 例：`' a , b ,, c '` → `['a', 'b', 'c']`
 */
export function parseList(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 将时间戳格式化为"相对时间"文案。
 *
 * 规则：
 * - 1 分钟内 → "刚刚"
 * - 1 小时内 → "X 分钟前"
 * - 24 小时内 → "X 小时前"
 * - 更久 → 回退为 "YYYY-MM-DD" 绝对日期
 *
 * 注意：使用 `Date.now()` 作为基准，未考虑时区差异（默认按浏览器本地时区展示）。
 *
 * @param ts 目标时间的 Unix 毫秒时间戳
 * @returns 人类可读的相对时间字符串
 */
export const formatRelativeTime = (ts: number): string => {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;

  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

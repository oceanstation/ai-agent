/**
 * 本地时区的日期/时间格式化小工具。
 */

import dayjs from 'dayjs';

/** yyyy-mm-dd（本地时区） */
export function formatDate(d: Date): string {
  return dayjs(d).format('YYYY-MM-DD');
}

/** HH:mm:ss（本地时区） */
export function formatTime(d: Date): string {
  return dayjs(d).format('HH:mm:ss');
}

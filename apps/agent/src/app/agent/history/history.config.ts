import type { ConfigService } from '@nestjs/config';
import * as path from 'node:path';

/**
 * History 子系统的运行时配置。
 *
 * 单用户本地部署：默认落地到 `./.data/history.db`（相对进程 cwd）。
 * 可通过环境变量 `HISTORY_DB_PATH` 覆盖数据库文件位置。
 */
export interface HistoryConfig {
  /** SQLite 数据库文件绝对路径 */
  dbFile: string;
  /** 首条用户消息截断长度，用作会话标题 */
  titleMaxLength: number;
}

const DEFAULT_DB_PATH = '.data/history.db';
const DEFAULT_TITLE_MAX_LENGTH = 40;

/**
 * 从 ConfigService 读取并归一化 History 配置。
 * 独立函数便于单测中直接构造。
 */
export function loadHistoryConfig(configService: ConfigService): HistoryConfig {
  const raw = configService.get<string>('HISTORY_DB_PATH') ?? DEFAULT_DB_PATH;
  const dbFile = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);

  return {
    dbFile,
    titleMaxLength: DEFAULT_TITLE_MAX_LENGTH,
  };
}

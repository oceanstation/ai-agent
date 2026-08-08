import type { ConfigService } from '@nestjs/config';
import { resolveAgentPath } from '../../paths';

/**
 * History 子系统的运行时配置。
 *
 * 路径解析优先级（见 apps/agent/src/app/paths.ts）：
 *   1. 显式 `HISTORY_DB_PATH`；
 *   2. `AGENT_DATA_DIR/.data/history.db`（Electron 等桌面壳注入 userData 时生效）；
 *   3. 兼容旧默认：`apps/agent/.data/history.db`（相对仓库根）。
 */
export interface HistoryConfig {
  /** SQLite 数据库文件绝对路径 */
  dbFile: string;
  /** 首条用户消息截断长度，用作会话标题 */
  titleMaxLength: number;
}

const DEFAULT_TITLE_MAX_LENGTH = 40;

/**
 * 从 ConfigService 读取并归一化 History 配置。
 * 独立函数便于单测中直接构造。
 */
export function loadHistoryConfig(configService: ConfigService): HistoryConfig {
  const dbFile = resolveAgentPath(
    configService.get<string>('HISTORY_DB_PATH'),
    '.data/history.db',
    'apps/agent/.data/history.db',
  );

  return {
    dbFile,
    titleMaxLength: DEFAULT_TITLE_MAX_LENGTH,
  };
}

import type { ConfigService } from '@nestjs/config';
import * as path from 'node:path';
import { parseIntSafe } from '../utils/config-parse';

/**
 * Memory 子系统的运行时配置。
 *
 * 单用户本地部署：默认落地到 `./apps/agent/.memory/`（相对仓库根 cwd）。
 * 所有配置项均可通过环境变量覆盖，未设置时使用默认值。
 */
export interface MemoryConfig {
  /** 记忆根目录（绝对路径） */
  root: string;
  /** 常青记忆文件绝对路径 */
  evergreenFile: string;
  /** 每日日志目录绝对路径 */
  dailyDir: string;
  /** 组 system prompt 时拼接最近多少天的日志 */
  recentDays: number;
  /** 是否启用自动 Flush */
  flushEnabled: boolean;
  /** 攒够 N 轮再触发一次 Flush（N ≥ 1） */
  flushEveryTurns: number;
  /** Flush 时至少有 N 条消息才做（过滤空会话/纯闲聊） */
  flushMinMessages: number;
}

const DEFAULT_ROOT = 'apps/agent/.memory';
const DEFAULT_RECENT_DAYS = 3;
const DEFAULT_FLUSH_EVERY_TURNS = 1;
const DEFAULT_FLUSH_MIN_MESSAGES = 2;

/**
 * 从 ConfigService 读取并归一化 Memory 相关配置。
 *
 * 之所以做成独立函数：便于在测试中直接构造 config，无需启动 Nest 容器。
 */
export function loadMemoryConfig(configService: ConfigService): MemoryConfig {
  const rawRoot = configService.get<string>('MEMORY_ROOT') ?? DEFAULT_ROOT;
  const root = path.isAbsolute(rawRoot)
    ? rawRoot
    : path.resolve(process.cwd(), rawRoot);

  return {
    root,
    evergreenFile: path.join(root, 'MEMORY.md'),
    dailyDir: path.join(root, 'memory'),
    recentDays: parseIntSafe(
      configService.get<string>('MEMORY_RECENT_DAYS'),
      DEFAULT_RECENT_DAYS,
    ),
    flushEnabled:
      (configService.get<string>('MEMORY_FLUSH_ENABLED') ?? 'true') !== 'false',
    flushEveryTurns: parseIntSafe(
      configService.get<string>('MEMORY_FLUSH_EVERY_TURNS'),
      DEFAULT_FLUSH_EVERY_TURNS,
    ),
    flushMinMessages: parseIntSafe(
      configService.get<string>('MEMORY_FLUSH_MIN_MESSAGES'),
      DEFAULT_FLUSH_MIN_MESSAGES,
    ),
  };
}

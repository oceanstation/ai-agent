import type { ConfigService } from '@nestjs/config';
import * as path from 'node:path';
import { parseBool, parseIntSafe, parseList } from '../utils/config-parse';

/**
 * Workspace 子系统运行时配置。
 *
 * "workspace" 指 Agent 可以读写的用户项目目录 —— Agent 的一切文件系统操作
 * （read_file / write_file / list_dir / run_command）都被强制限制在这个目录内。
 *
 */
export interface WorkspaceConfig {
  /** workspace 根目录（绝对路径，符号链接已解开） */
  root: string;
  /** 是否允许写操作（write_file），默认 false */
  writable: boolean;
  /** 是否允许命令执行（run_command），默认 false */
  commandEnabled: boolean;
  /** 单文件读写字节上限，默认 1 MB */
  maxFileSize: number;
  /** 列目录最多返回的条目数，防止巨型目录爆上下文 */
  maxListEntries: number;
  /** run_command 单次最大 stdout/stderr 字节数 */
  maxCommandOutput: number;
  /** run_command 超时（毫秒） */
  commandTimeoutMs: number;
  /** 命令白名单（可执行文件名，不含路径） */
  commandAllowlist: string[];
  /**
   * 拒绝匹配的相对路径 glob（相对 workspace 根，使用 `/` 分隔）。
   * 采用极简 glob 语义：`**` 匹配任意层级，`*` 匹配单段任意字符。
   */
  denyGlobs: string[];
  /**
   * 是否按 sessionId 隔离文件读写：开启后每个会话的 read/write/list/run_command
   * 都落在 `<root>/<sessionsDir>/<sessionId>/` 子目录内，互不可见。默认 true。
   */
  isolateBySession: boolean;
  /** session 隔离时的子目录容器名（相对 root），默认 `sessions` */
  sessionsDir: string;
}

const DEFAULT_MAX_FILE_SIZE = 1024 * 1024; // 1 MB
const DEFAULT_MAX_LIST_ENTRIES = 200;
const DEFAULT_MAX_COMMAND_OUTPUT = 64 * 1024; // 64 KB
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;

/** 默认 deny 列表：常见敏感 / 无意义目录 */
const DEFAULT_DENY_GLOBS = [
  '.git/**',
  '.git',
  'node_modules/**',
  'node_modules',
  '.env',
  '.env.*',
  '**/*.pem',
  '**/*.key',
  '**/id_rsa',
  '**/id_rsa.pub',
];

export function loadWorkspaceConfig(
  configService: ConfigService,
): WorkspaceConfig {
  const rawRoot = configService.get<string>('WORKSPACE_ROOT');
  const root = rawRoot
    ? path.isAbsolute(rawRoot)
      ? rawRoot
      : path.resolve(process.cwd(), rawRoot)
    : process.cwd();

  return {
    root,
    writable: parseBool(configService.get<string>('WORKSPACE_WRITABLE'), false),
    commandEnabled: parseBool(
      configService.get<string>('WORKSPACE_COMMAND_ENABLED'),
      false,
    ),
    maxFileSize: parseIntSafe(
      configService.get<string>('WORKSPACE_MAX_FILE_SIZE'),
      DEFAULT_MAX_FILE_SIZE,
    ),
    maxListEntries: parseIntSafe(
      configService.get<string>('WORKSPACE_MAX_LIST_ENTRIES'),
      DEFAULT_MAX_LIST_ENTRIES,
    ),
    maxCommandOutput: parseIntSafe(
      configService.get<string>('WORKSPACE_MAX_COMMAND_OUTPUT'),
      DEFAULT_MAX_COMMAND_OUTPUT,
    ),
    commandTimeoutMs: parseIntSafe(
      configService.get<string>('WORKSPACE_COMMAND_TIMEOUT_MS'),
      DEFAULT_COMMAND_TIMEOUT_MS,
    ),
    commandAllowlist: parseList(
      configService.get<string>('WORKSPACE_COMMAND_ALLOWLIST'),
    ),
    denyGlobs: [
      ...DEFAULT_DENY_GLOBS,
      ...parseList(configService.get<string>('WORKSPACE_DENY_GLOBS')),
    ],
    isolateBySession: parseBool(
      configService.get<string>('WORKSPACE_ISOLATE_BY_SESSION'),
      true,
    ),
    sessionsDir:
      configService.get<string>('WORKSPACE_SESSIONS_DIR')?.trim() || 'sessions',
  };
}

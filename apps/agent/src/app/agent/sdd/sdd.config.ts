import type { ConfigService } from '@nestjs/config';
import * as path from 'node:path';

/**
 * SDD 子系统运行时配置。
 *
 * 产物落盘目录约定：<root>/<featureId>/{specify,plan,tasks,implement}.md
 * 状态文件：<root>/<featureId>/state.json
 */
export interface SddConfig {
  /** SDD 根目录（绝对路径） */
  root: string;
}

/** 默认落在 workspace 根下的 `.specify/` */
const DEFAULT_DIR = '.specify';

export function loadSddConfig(configService: ConfigService): SddConfig {
  const rawSdd = configService.get<string>('SDD_ROOT');
  if (rawSdd) {
    const root = path.isAbsolute(rawSdd)
      ? rawSdd
      : path.resolve(process.cwd(), rawSdd);
    return { root };
  }

  const rawWorkspace = configService.get<string>('WORKSPACE_ROOT');
  const workspaceRoot = rawWorkspace
    ? path.isAbsolute(rawWorkspace)
      ? rawWorkspace
      : path.resolve(process.cwd(), rawWorkspace)
    : process.cwd();

  return { root: path.join(workspaceRoot, DEFAULT_DIR) };
}

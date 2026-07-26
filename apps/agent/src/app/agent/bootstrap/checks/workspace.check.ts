import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import { WorkspaceService } from '../../workspace/workspace.service';
import type { BootstrapCheck, CheckResult } from '../bootstrap.types';

/**
 * WorkspaceCheck：确保工作区根目录存在且可用。
 *
 * 行为：
 *   - 目录已存在 → ok；
 *   - 目录不存在 → 自动 mkdir -p 创建 → repaired；
 *   - 路径存在但不是目录 → fail（无法自愈）；
 *   - 目录存在但不可写且 workspace 配置为 writable → warn（不阻断）。
 */
@Injectable()
export class WorkspaceCheck implements BootstrapCheck {
  readonly name = 'workspace';
  private readonly logger = new Logger(WorkspaceCheck.name);

  constructor(private readonly workspace: WorkspaceService) {}

  async run(): Promise<CheckResult> {
    const cfg = this.workspace.getConfig();
    const root = cfg.root;

    // Step 1: 探测目标是否存在，以及是不是目录
    const stat = await fs.stat(root).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return null;
      throw err;
    });

    if (stat && !stat.isDirectory()) {
      return {
        status: 'fail',
        message: `workspace 根路径已存在但不是目录：${root}`,
        details: { root },
      };
    }

    // Step 2: 不存在则自动创建
    let repaired = false;
    if (!stat) {
      this.logger.log(`工作目录不存在，自动创建：${root}`);
      await fs.mkdir(root, { recursive: true });
      repaired = true;
    }

    // Step 3: 若开启了写权限，追加一次写探针；失败不算致命，仅 warn
    if (cfg.writable) {
      try {
        await fs.access(root, fs.constants.W_OK);
      } catch {
        return {
          status: 'warn',
          message: `workspace 已启用写权限，但目录不可写：${root}`,
          details: { root, writable: cfg.writable },
        };
      }
    }

    return {
      status: repaired ? 'repaired' : 'ok',
      message: repaired
        ? `工作目录已自动创建：${root}`
        : `工作目录就绪：${root}`,
      details: {
        root,
        writable: cfg.writable,
        commandEnabled: cfg.commandEnabled,
      },
    };
  }
}

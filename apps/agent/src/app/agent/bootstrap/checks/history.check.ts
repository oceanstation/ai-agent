import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { HistoryService } from '../../history/history.service';
import type { BootstrapCheck, CheckResult } from '../bootstrap.types';

/**
 * HistoryCheck：确认 SQLite 历史库已就绪。
 *
 * 行为：
 *   - HistoryService.isReady() = true → ok；
 *   - 数据库目录不存在则自动 mkdir -p → repaired（下次启动 HistoryService 就能连上）；
 *   - 目录存在但连接失败 → warn（历史记录不可用，但不阻断主流程）。
 *
 * 注：真正的连接动作发生在 HistoryService.onModuleInit（更早于 bootstrap），
 */
@Injectable()
export class HistoryCheck implements BootstrapCheck {
  readonly name = 'history';

  constructor(private readonly history: HistoryService) {}

  async run(): Promise<CheckResult> {
    const { dbFile } = this.history.getConfig();

    if (this.history.isReady()) {
      return {
        status: 'ok',
        message: `SQLite 已就绪：${dbFile}`,
        details: { dbFile },
      };
    }

    // 未就绪时尝试补齐目录，方便下次启动恢复
    const dir = path.dirname(dbFile);
    const dirExists = await fs
      .stat(dir)
      .then((s) => s.isDirectory())
      .catch(() => false);
    if (!dirExists) {
      await fs.mkdir(dir, { recursive: true });
      return {
        status: 'repaired',
        message: `历史库目录已自动创建：${dir}（下次启动生效）`,
        details: { dbFile, dir },
      };
    }

    return {
      status: 'warn',
      message: `SQLite 连接未建立，历史记录将不可用：${dbFile}`,
      details: { dbFile },
    };
  }
}

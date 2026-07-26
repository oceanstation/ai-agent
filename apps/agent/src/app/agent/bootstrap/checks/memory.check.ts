import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import { MemoryService } from '../../memory/memory.service';
import type { BootstrapCheck, CheckResult } from '../bootstrap.types';

/**
 * MemoryCheck：确认记忆目录/常青记忆文件存在。
 *
 * 行为：
 *   - dailyDir 不存在 → 自动 mkdir -p → repaired；
 *   - MEMORY.md 不存在 → ok（不做"创建空文件"动作，延迟到首次写入时由 MemoryService 生成）；
 *   - 两者都在 → ok。
 *
 * 注：MemoryService 内部 serializedAppend 已经在写入时做 mkdir，
 * 但提前建好目录能保证读取路径干净、也让用户在 tree 里看到明确结构。
 */
@Injectable()
export class MemoryCheck implements BootstrapCheck {
  readonly name = 'memory';

  constructor(private readonly memory: MemoryService) {}

  async run(): Promise<CheckResult> {
    const { root, dailyDir, evergreenFile } = this.memory.getConfig();

    // Step 1: 记忆根目录 + 当日日志目录一并保证存在
    let repaired = false;
    const dailyExists = await fs
      .stat(dailyDir)
      .then((s) => s.isDirectory())
      .catch(() => false);
    if (!dailyExists) {
      await fs.mkdir(dailyDir, { recursive: true });
      repaired = true;
    }

    // Step 2: 常青记忆文件（MEMORY.md）不做隐式创建，只汇报状态
    const evergreenExists = await fs
      .stat(evergreenFile)
      .then((s) => s.isFile())
      .catch(() => false);

    if (repaired) {
      return {
        status: 'repaired',
        message: `记忆目录已自动创建：${dailyDir}`,
        details: { root, dailyDir, evergreenFile, evergreenExists },
      };
    }

    if (!evergreenExists) {
      return {
        status: 'ok',
        message: `记忆目录就绪：${root}（MEMORY.md 尚未创建，延迟到首次写入）`,
        details: { root, dailyDir, evergreenFile, evergreenExists: false },
      };
    }

    return {
      status: 'ok',
      message: `记忆目录就绪：${root}`,
      details: { root, dailyDir, evergreenFile, evergreenExists: true },
    };
  }
}

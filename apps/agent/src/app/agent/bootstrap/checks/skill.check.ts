import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import { SkillService } from '../../skills/skill.service';
import type { BootstrapCheck, CheckResult } from '../bootstrap.types';

/**
 * SkillCheck：汇报 skills 目录扫描结果。
 *
 * 行为：
 *   - skills 目录不存在 → 自动 mkdir -p → repaired（提示用户可放入 SKILL.md）；
 *   - 目录存在但为空 → warn（skill 列表为空不算致命，仅提示）；
 *   - 加载到 ≥1 个 skill → ok。
 *
 * 注：SkillService.onModuleInit 已经完成扫描，这里只做“汇报 + 目录自愈”。
 */
@Injectable()
export class SkillCheck implements BootstrapCheck {
  readonly name = 'skills';

  constructor(private readonly skills: SkillService) {}

  async run(): Promise<CheckResult> {
    const { root } = this.skills.getConfig();

    const dirExists = await fs
      .stat(root)
      .then((s) => s.isDirectory())
      .catch(() => false);

    if (!dirExists) {
      await fs.mkdir(root, { recursive: true });
      return {
        status: 'repaired',
        message: `skills 目录已自动创建：${root}`,
        details: { root, count: 0 },
      };
    }

    const names = this.skills.listNames();
    if (names.length === 0) {
      return {
        status: 'warn',
        message: `未发现任何 skill（目录：${root}）`,
        details: { root, count: 0 },
      };
    }

    return {
      status: 'ok',
      message: `已加载 ${names.length} 个 skill：${names.join(', ')}`,
      details: { root, count: names.length, names },
    };
  }
}

import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import pc from 'picocolors';
import {
  BOOTSTRAP_CHECKS,
  type BootstrapCheck,
  type CheckResult,
  type CheckStatus,
} from './bootstrap.types';

/** 每种状态的展示样式集中在此，方便统一调整。 */
const STATUS_STYLE: Record<
  CheckStatus,
  { icon: string; label: string; color: (t: string) => string }
> = {
  ok: {
    icon: '✔',
    label: ' OK ',
    color: pc.gray,
  },
  repaired: {
    icon: '🔧',
    label: 'FIX ',
    color: pc.cyan,
  },
  warn: {
    icon: '⚠',
    label: 'WARN',
    color: pc.yellow,
  },
  fail: {
    icon: '✖',
    label: 'FAIL',
    color: (t) => pc.bold(pc.red(t)),
  },
};

const DIVIDER = '═'.repeat(60);

/**
 * BootstrapService：Agent 启动自检编排器。
 *
 * 失败策略：
 *   - fail  → 抛异常，直接阻断应用启动（fail-fast 优于带病运行）；
 *   - warn  → 打 warn 日志，继续启动；
 *   - repaired → 打 info 日志（提示"已自愈"）；
 *   - ok    → 只在 verbose 日志里体现。
 */
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    @Inject(BOOTSTRAP_CHECKS)
    private readonly checks: BootstrapCheck[], // 自动在类上声明 checks，同时自动赋值
  ) {}

  // 所有 module 就绪后才触发（让子系统各自的 init 先跑完，避免相互依赖顺序踩坑）
  async onApplicationBootstrap(): Promise<void> {
    if (!this.checks.length) {
      this.logger.debug('未注册任何自检项，跳过 bootstrap 流程');
      return;
    }

    this.logger.log(pc.magenta(DIVIDER));
    this.logger.log(
      pc.bold(pc.magenta(`🚀 Agent 启动自检 · 共 ${this.checks.length} 项`)),
    );
    this.logger.log(pc.magenta(DIVIDER));

    const summary: Array<{ name: string; result: CheckResult }> = [];
    const failures: Array<{ name: string; result: CheckResult }> = [];

    for (const check of this.checks) {
      const result = await this.safeRun(check);
      summary.push({ name: check.name, result });
      this.printOne(check.name, result);
      if (result.status === 'fail') failures.push({ name: check.name, result });
    }

    this.printSummary(summary);

    if (failures.length) {
      const detail = failures
        .map((f) => `- [${f.name}] ${f.result.message}`)
        .join('\n');
      throw new Error(`Agent 启动自检失败：\n${detail}`);
    }
  }

  /** 单个 check 抛出的异常统一收敛为 fail 结果，避免影响后续 check。 */
  private async safeRun(check: BootstrapCheck): Promise<CheckResult> {
    try {
      return await check.run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: 'fail',
        message: `执行异常：${msg}`,
        details: { error: msg },
      };
    }
  }

  private printOne(name: string, result: CheckResult): void {
    const style = STATUS_STYLE[result.status];
    const badge = style.color(`[${style.label}]`);
    const line = `${style.icon} ${badge}  ${pc.bold(name.padEnd(12))}  ${result.message}`;

    switch (result.status) {
      case 'ok':
        this.logger.debug(line);
        break;
      case 'repaired':
        this.logger.log(line);
        break;
      case 'warn':
        this.logger.warn(line);
        break;
      case 'fail':
        this.logger.error(line);
        break;
    }
  }

  private printSummary(
    summary: Array<{ name: string; result: CheckResult }>,
  ): void {
    const count = summary.reduce<Record<CheckStatus, number>>(
      (acc, s) => {
        acc[s.result.status] = (acc[s.result.status] ?? 0) + 1;
        return acc;
      },
      { ok: 0, repaired: 0, warn: 0, fail: 0 },
    );

    // 每个状态项：只有计数 > 0 才带主色，= 0 一律灰色，避免"ok=0"抢眼
    const seg = (status: CheckStatus, n: number) => {
      const text = `${STATUS_STYLE[status].label.trim().toLowerCase()}=${n}`;
      return n > 0 ? STATUS_STYLE[status].color(text) : pc.gray(text);
    };

    const body = [
      seg('ok', count.ok),
      seg('repaired', count.repaired),
      seg('warn', count.warn),
      seg('fail', count.fail),
    ].join('  ');

    this.logger.log(pc.magenta(DIVIDER));
    this.logger.log(`📋 自检完成 · ${body}`);
    this.logger.log(pc.magenta(DIVIDER));
  }
}

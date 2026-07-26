/**
 * Bootstrap 子系统的公共类型定义。
 *
 * 该子系统承担 Agent 启动时的“自检 & 自愈”职责：
 *   - 检查关键资源是否就绪（工作目录、记忆目录、数据库文件、依赖服务等）；
 *   - 缺失时按“可自愈”策略修复（如 mkdir -p）或直接快速失败；
 *   - 汇总每一项的检查结果，作为应用真正对外服务前的最后一道关。
 *
 * 抽象成独立子系统的目的：后续还会陆续加入更多自检项（例如向量库连通性、外部 API 可达性等），统一走一个入口更易于观测和维护。
 */

/** 单个自检项的执行状态。 */
export type CheckStatus = 'ok' | 'repaired' | 'warn' | 'fail';

/** 单个自检项的执行结果。 */
export interface CheckResult {
  /** 结果状态。 */
  status: CheckStatus;
  /** 一行摘要，供日志与错误信息展示。 */
  message: string;
  /** 可选的结构化明细，供调试或前端展示。 */
  details?: Record<string, unknown>;
}

/**
 * 单个自检项的行为契约。
 *
 * 实现者只需负责“做检查 + 尝试修复 + 返回结果”，
 * 编排、日志、失败处理由 BootstrapService 统一负责。
 */
export interface BootstrapCheck {
  /** 名称，用于日志与错误定位，建议使用小写 kebab-case。 */
  readonly name: string;
  /** 执行检查。抛异常等价于返回 status='fail'。 */
  run(): Promise<CheckResult>;
}

/**
 * BootstrapCheck 集合的 DI 注入令牌。
 *
 * 每一个具体 check 通过 provider 追加进这个数组，
 * BootstrapService 用 @Inject(BOOTSTRAP_CHECKS) 收集执行。
 */
export const BOOTSTRAP_CHECKS = Symbol('BOOTSTRAP_CHECKS');

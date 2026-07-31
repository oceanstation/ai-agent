/**
 * SDD（Spec-Driven Development）子系统的核心类型。
 *
 * 一个 feature 的生命周期沿"specify → plan → tasks → implement"四阶段推进；
 * 每个阶段必须先由用户显式批准后才能写入下一阶段，闸门在工具入口校验。
 */

/** 四个规约阶段 */
export type SddPhase = 'specify' | 'plan' | 'tasks' | 'implement';

/** 阶段顺序，供闸门校验时按索引比较 */
export const SDD_PHASES: readonly SddPhase[] = [
  'specify',
  'plan',
  'tasks',
  'implement',
] as const;

/** 单个阶段的历史记录：一次写入 + 至多一次批准 */
export interface SddPhaseRecord {
  phase: SddPhase;
  /** 最近一次写入时间戳（epoch ms） */
  writtenAt: number;
  /**
   * 批准时间戳（epoch ms）；未批准为 null。
   * implement 阶段本身不接受批准，永远为 null。
   */
  approvedAt: number | null;
}

/** state.json 的持久化结构 */
export interface SddState {
  featureId: string;
  /** 当前允许写入的阶段（最新一次成功写入的阶段） */
  currentPhase: SddPhase;
  /** 各阶段的历史记录，按写入时间递增 */
  history: SddPhaseRecord[];
  /** state 最近一次变更时间（epoch ms） */
  updatedAt: number;
}

/** 供 system prompt 展示的活跃 feature 视图 */
export interface SddFeatureView {
  featureId: string;
  currentPhase: SddPhase;
  /** 每个阶段的进度标记，未开始为 null */
  statuses: Record<SddPhase, 'approved' | 'pending' | null>;
}

export interface SddView {
  /** 全量活跃 feature（按 updatedAt 倒序） */
  features: SddFeatureView[];
  /** 最近活跃的 feature id，可能为 null */
  active: SddFeatureView | null;
}

/** 单个阶段在时间线上的状态标记 */
export type SddPhaseStatus = 'approved' | 'pending' | 'current' | 'idle';

/** sdd_write_artifact 的返回结构，会经 tool_result 转成 SpecGateBlock */
export interface SddGateSignal {
  /** 供 agent.blocks.ts 识别用的判别位 */
  __sddGate: true;
  featureId: string;
  phase: SddPhase;
  /** 相对 SDD 根目录的产物路径，例如 `user-avatar/plan.md` */
  path: string;
  /** 仅当该阶段确实待批准（非 implement 且尚未批准）时为 true；已批准阶段被覆写为 false */
  pendingApproval: boolean;
  /** 全量 4 阶段时间线状态（前端渲染进度条使用） */
  timeline: Record<SddPhase, SddPhaseStatus>;
}

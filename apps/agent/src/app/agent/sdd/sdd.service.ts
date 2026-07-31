import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { loadSddConfig, type SddConfig } from './sdd.config';
import {
  SDD_PHASES,
  type SddFeatureView,
  type SddPhase,
  type SddPhaseRecord,
  type SddPhaseStatus,
  type SddState,
  type SddView,
} from './sdd.types';

/** 允许 featureId 使用的字符（避免路径逃逸 / 大小写歧义） */
const FEATURE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * SddService：SDD 阶段状态机 + 产物读写。
 *
 * 职责：
 *   1. 校验 featureId 合法性，拒绝任何形式的路径逃逸；
 *   2. 阶段闸门：进入下一阶段前必须先批准当前阶段；
 *   3. 串行化写盘，避免同一 feature 的并发写入交叉。
 */
@Injectable()
export class SddService {
  private readonly logger = new Logger(SddService.name);
  private readonly config: SddConfig;
  /** 单进程内的写锁，仿 MemoryService.writeChain */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(configService: ConfigService) {
    this.config = loadSddConfig(configService);
  }

  getConfig(): Readonly<SddConfig> {
    return this.config;
  }

  // ===================== 读 =====================

  /** 读取某个 feature 的状态；不存在返回 null */
  async getState(featureId: string): Promise<SddState | null> {
    this.assertFeatureId(featureId);
    return this.readState(featureId);
  }

  /**
   * 读取产物：不传 phase 返回所有已写阶段；传 phase 只读该阶段。
   * 每个阶段最多一份产物文件（覆写模式）。
   */
  async readArtifact(
    featureId: string,
    phase?: SddPhase,
  ): Promise<{ phase: SddPhase; path: string; content: string }[]> {
    this.assertFeatureId(featureId);
    const state = await this.readState(featureId);
    if (!state) return [];

    const targets = phase
      ? state.history.filter((h) => h.phase === phase)
      : state.history;

    const out: { phase: SddPhase; path: string; content: string }[] = [];
    for (const rec of targets) {
      const abs = this.artifactPath(featureId, rec.phase);
      try {
        const content = await fs.readFile(abs, 'utf-8');
        out.push({
          phase: rec.phase,
          path: this.toRelative(abs),
          content,
        });
      } catch (err) {
        // 文件被外部删除 —— 记录状态但读不到内容，作为空串返回，模型可自行决策
        this.logger.warn(
          `读取 SDD 产物失败 ${abs}: ${(err as Error).message}`,
        );
        out.push({
          phase: rec.phase,
          path: this.toRelative(abs),
          content: '',
        });
      }
    }
    return out;
  }

  // ===================== 写 =====================

  /**
   * 写入一个阶段的产物。
   *
   * 闸门规则：
   *   - `specify` 永远可写；
   *   - `plan` / `tasks` / `implement`：前一个阶段必须已批准。
   *   - 覆写已存在的阶段**保留其批准状态**（见 {@link recordPhase}）。
   *
   * pendingApproval：仅当该阶段确实"待批准"（非 implement 且尚未批准）时为 true。
   * 已批准阶段被覆写（如 implement 勾选 tasks 清单）不会再次要求批准。
   */
  async writeArtifact(
    featureId: string,
    phase: SddPhase,
    content: string,
  ): Promise<{
    path: string;
    pendingApproval: boolean;
    timeline: Record<SddPhase, SddPhaseStatus>;
  }> {
    this.assertFeatureId(featureId);
    if (!content.trim()) {
      throw new Error('SDD 产物内容为空，拒绝写入');
    }

    return this.enqueue(async () => {
      const state = (await this.readState(featureId)) ?? this.initialState(featureId);
      this.assertPhaseAllowed(state, phase);

      const abs = this.artifactPath(featureId, phase);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, 'utf-8');

      const now = Date.now();
      const nextState: SddState = this.recordPhase(state, phase, now);
      await this.persistState(nextState);

      const rec = nextState.history.find((h) => h.phase === phase);
      const pendingApproval = phase !== 'implement' && rec?.approvedAt == null;

      return {
        path: this.toRelative(abs),
        pendingApproval,
        timeline: this.buildTimeline(nextState),
      };
    });
  }

  /**
   * 批准指定阶段。implement 是终态，不接受批准。
   * 若目标阶段没有写入记录会抛错。
   */
  async approve(featureId: string, phase: SddPhase): Promise<SddState> {
    this.assertFeatureId(featureId);
    if (phase === 'implement') {
      throw new Error('implement 是终态，不接受批准');
    }
    return this.enqueue(async () => {
      const state = await this.readState(featureId);
      if (!state) {
        throw new Error(`feature "${featureId}" 尚未开始`);
      }
      const rec = state.history.find((h) => h.phase === phase);
      if (!rec) {
        throw new Error(`阶段 "${phase}" 尚未写入，无法批准`);
      }
      rec.approvedAt = Date.now();
      state.updatedAt = Date.now();
      await this.persistState(state);
      return state;
    });
  }

  // ===================== 供 system prompt =====================

  /**
   * 汇总所有 feature 的状态，供 buildSystemPrompt 显示。
   * 未初始化目录时直接返回空视图。
   */
  async buildContext(): Promise<SddView> {
    const entries = await this.safeReadDir(this.config.root);
    const features: SddFeatureView[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!FEATURE_ID_RE.test(entry.name)) continue;
      const state = await this.readState(entry.name);
      if (!state) continue;
      features.push(this.toFeatureView(state));
    }
    // 按最近活跃倒序
    features.sort((a, b) => {
      const ta = this.lastTouched(a);
      const tb = this.lastTouched(b);
      return tb - ta;
    });
    return {
      features,
      active: features[0] ?? null,
    };
  }

  // ===================== 私有辅助 =====================

  private assertFeatureId(featureId: string): void {
    if (!FEATURE_ID_RE.test(featureId)) {
      throw new Error(
        `非法 featureId "${featureId}"：仅允许小写字母、数字、-、_、. 且需以字母/数字开头，长度 ≤ 64`,
      );
    }
  }

  /** 若目标阶段不是 specify，前一阶段必须已批准 */
  private assertPhaseAllowed(state: SddState, target: SddPhase): void {
    if (target === 'specify') return;
    const idx = SDD_PHASES.indexOf(target);
    const prev = SDD_PHASES[idx - 1];
    const prevRec = state.history.find((h) => h.phase === prev);
    if (!prevRec || prevRec.approvedAt == null) {
      throw new Error(
        `未批准的阶段跃迁：当前处于 ${state.currentPhase}，需先批准 ${prev} 后才能写入 ${target}。`,
      );
    }
  }

  private initialState(featureId: string): SddState {
    return {
      featureId,
      currentPhase: 'specify',
      history: [],
      updatedAt: Date.now(),
    };
  }

  /**
   * 把一次写入合并进 state。
   *
   * 关键：**覆写已存在的阶段不会清空其批准状态**。
   * 早期实现会在覆写时把 approvedAt 置空，导致 implement 阶段回写 tasks.md
   * 勾选复选框（`- [ ]` → `- [x]`）时，tasks 的批准被悄悄撤销 —— 既弹出重复的
   * 审批卡片，又会让随后写 implement 时报"需先批准 tasks"。现在覆写只刷新
   * writtenAt、保留原批准：审批是用户对"该阶段是否成立"的一次性决定，
   * 过程性回写不应触发重新审批。未批准阶段覆写后仍是未批准（保持 pending）。
   */
  private recordPhase(
    state: SddState,
    phase: SddPhase,
    now: number,
  ): SddState {
    const existing = state.history.find((h) => h.phase === phase);
    if (existing) {
      existing.writtenAt = now;
      // 保留 existing.approvedAt：覆写不撤销既有批准
    } else {
      const rec: SddPhaseRecord = { phase, writtenAt: now, approvedAt: null };
      state.history.push(rec);
    }
    state.currentPhase = phase;
    state.updatedAt = now;
    return state;
  }

  private artifactPath(featureId: string, phase: SddPhase): string {
    return path.join(this.config.root, featureId, `${phase}.md`);
  }

  private stateFilePath(featureId: string): string {
    return path.join(this.config.root, featureId, 'state.json');
  }

  private toRelative(abs: string): string {
    const rel = path.relative(this.config.root, abs);
    return rel.split(path.sep).join('/');
  }

  private async readState(featureId: string): Promise<SddState | null> {
    const file = this.stateFilePath(featureId);
    try {
      const raw = await fs.readFile(file, 'utf-8');
      const parsed = JSON.parse(raw) as SddState;
      // 简单结构校验；损坏时警告并按不存在处理
      if (
        typeof parsed?.featureId !== 'string' ||
        !Array.isArray(parsed?.history)
      ) {
        this.logger.warn(`SDD state.json 结构异常，忽略：${file}`);
        return null;
      }
      return parsed;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return null;
      this.logger.warn(`读取 SDD state 失败 ${file}: ${(err as Error).message}`);
      return null;
    }
  }

  private async persistState(state: SddState): Promise<void> {
    const file = this.stateFilePath(state.featureId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(state, null, 2), 'utf-8');
  }

  private async safeReadDir(dir: string): Promise<import('node:fs').Dirent[]> {
    try {
      return await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        this.logger.warn(
          `扫描 SDD 根目录失败 ${dir}: ${(err as Error).message}`,
        );
      }
      return [];
    }
  }

  private toFeatureView(state: SddState): SddFeatureView {
    const statuses = {
      specify: null,
      plan: null,
      tasks: null,
      implement: null,
    } as Record<SddPhase, 'approved' | 'pending' | null>;
    for (const rec of state.history) {
      statuses[rec.phase] = rec.approvedAt != null ? 'approved' : 'pending';
    }
    // implement 阶段永远不会显示 approved（也不接受 approve），保持 pending/null
    if (statuses.implement === 'approved') {
      statuses.implement = 'pending';
    }
    return {
      featureId: state.featureId,
      currentPhase: state.currentPhase,
      statuses,
    };
  }

  /**
   * 把 state 展开成 4 阶段时间线：
   *   - approved：该阶段已被用户批准
   *   - pending：已写入但待批准（implement 完成也用这个态）
   *   - current：写入过但被后续覆写清空批准（仅 currentPhase 出现）
   *   - idle：从未开始
   *
   * 前端据此在批准卡片里画一条 4 步时间线。
   */
  private buildTimeline(state: SddState): Record<SddPhase, SddPhaseStatus> {
    const timeline: Record<SddPhase, SddPhaseStatus> = {
      specify: 'idle',
      plan: 'idle',
      tasks: 'idle',
      implement: 'idle',
    };
    for (const rec of state.history) {
      timeline[rec.phase] = rec.approvedAt != null ? 'approved' : 'pending';
    }
    return timeline;
  }

  private lastTouched(view: SddFeatureView): number {
    // 只有 statuses，缺 writtenAt；活跃度用 currentPhase 序号 + 是否 approved 简单打分即可
    const phaseIdx = SDD_PHASES.indexOf(view.currentPhase);
    const boost = view.statuses[view.currentPhase] === 'approved' ? 0.5 : 0;
    return phaseIdx + boost;
  }

  /**
   * 串行化写入：同一进程内，SDD 的写盘按 FIFO 顺序执行，
   * 避免两次并发 write/approve 相互覆盖 state.json。
   */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.writeChain.then(task);
    // 无论成败都让链继续；错误由本次调用方感知
    this.writeChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

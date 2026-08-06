import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { ContentBlock } from '@ai-agent/common';
import { messagesToBlocks } from './agent.blocks';
import { AgentService } from './agent.service';
import type { AgentInvokeResult } from './agent.types';
import { randomUUID } from 'crypto';

/**
 * 单次 agent 执行的运行时状态。
 *
 * 每次 `/agent/invoke` 都会创建一个 Run，agent 在后台跑（不依赖 HTTP 连接），
 * 产出的 ContentBlock 顺序追加到 `blocks` 并同时广播给所有订阅者。
 * 前端页面刷新后凭 `runId + cursor` 可从 `blocks[cursor:]` 回放并继续订阅。
 */
export interface AgentRun {
  runId: string;
  sessionId: string;
  status: 'running' | 'done' | 'error';
  /** 有序缓冲区：从 index=0 到当前为止产出的全部 block（含首帧 session 之外的所有块） */
  blocks: ContentBlock[];
  /** 广播管道：running 期间每 push 一块 blocks，也会 next 一份 */
  subject: Subject<ContentBlock>;
  /** run 结束的错误信息，仅 status='error' 时有值 */
  error?: string;
  /** 结束时间戳，用于垃圾回收判定；running 中为 undefined */
  finishedAt?: number;
}

const FINISHED_RUN_TTL_MS = 5 * 60 * 1000; // 已结束的 run 保留时长
const GC_INTERVAL = 60 * 1000; // 垃圾回收巡检间隔

/**
 * AgentRunService —— 把"agent 执行"与"SSE 传输"解耦。
 *
 * 设计要点：
 * 1. Run 一旦启动就在后台跑到底，在任何情况下都能完成（这是"断线重连"的根基）。
 * 2. Run 内部维护完整 blocks 序列，任何新的订阅者都能通过 cursor 回放追赶到最新进度。
 * 3. 已结束的 run 保留 5 分钟供刷新页面重连，之后由 GC 定时清理，避免内存泄漏。
 * 4. Blocks 增量策略沿用原 controller 的做法：每次 chunk 到达时对全量 messages 做
 *    过滤转换，与已推数量 diff 只发新增部分，保证不重复不遗漏。
 */
@Injectable()
export class AgentRunService implements OnModuleDestroy {
  private readonly logger = new Logger(AgentRunService.name);
  private readonly activeRuns = new Map<string, AgentRun>();
  private readonly gcTimer: NodeJS.Timeout;

  constructor(private readonly agentService: AgentService) {
    this.gcTimer = setInterval(() => this.gc(), GC_INTERVAL);
    this.gcTimer.unref?.(); // Node 允许进程在没有其他任务时退出，不被本定时器阻挡
  }

  onModuleDestroy(): void {
    clearInterval(this.gcTimer);
    for (const run of this.activeRuns.values()) {
      run.subject.complete();
    }
    this.activeRuns.clear();
  }

  /**
   * 启动一个后台 run。
   * 立即返回 Run 对象，agent 在 microtask 中开始执行，调用方通常紧接着调用
   * {@link subscribe} 订阅其输出。
   */
  start(input: { message: string; sessionId: string }): AgentRun {
    const runId = randomUUID();
    const run: AgentRun = {
      runId,
      sessionId: input.sessionId,
      status: 'running',
      blocks: [],
      subject: new Subject<ContentBlock>(),
    };
    this.activeRuns.set(runId, run);

    // 后台异步执行；不 await，让 start() 立即返回
    void this.execute(run, input);

    return run;
  }

  /** 获取 run 快照（用于订阅前的存在性判断 / 状态查询） */
  get(runId: string): AgentRun | undefined {
    return this.activeRuns.get(runId);
  }

  /**
   * 订阅一个 run 的输出流。
   *
   * - `cursor`：调用方已消费到的 block 索引；[0, cursor) 视为已收到，从 blocks[cursor:] 开始回放。
   * - 返回一个 async iterator，先回放已缓存部分，再消费未来增量；run 结束后自然结束。
   *
   * 如果 run 已经是终态且 cursor 已追上，也会立即以 done/error 结束，不会挂起。
   */
  async *subscribe(runId: string, cursor = 0): AsyncGenerator<ContentBlock> {
    const run = this.activeRuns.get(runId);
    if (!run) {
      throw new Error(`run not found: ${runId}`);
    }

    // 用一个队列桥接 rxjs Subject → async iterator，避免中途 push 的 block 被漏掉。
    // 关键点：**先订阅、后回放**，能保证订阅期间新增的 block 一定进入 pending。
    const pending: ContentBlock[] = [];
    let resolveNext: (() => void) | null = null;
    let ended = false;
    let error: unknown = null;

    const wake = () => {
      const r = resolveNext; // ① 取出当前挂起的 resolver
      resolveNext = null; // ② 立刻置空，防止重复调用
      r?.(); // ③ 调用它，把 await 解开
    };

    // rxjs 订阅句柄；保存下来是为了在 finally 里 unsubscribe，
    // 防止消费者提前退出（break / return / 抛异常）时订阅泄漏。
    const subscription = run.subject.subscribe({
      next: (b) => {
        pending.push(b);
        wake();
      },
      error: (e) => {
        error = e;
        ended = true;
        wake();
      },
      complete: () => {
        ended = true;
        wake();
      },
    });

    try {
      /**
       * 因为 pushBlock 里"先落缓冲、后广播" + Node 单线程原子性，
       * 回放区间 [cursor, replayEnd) 与 pending 中 block 的下标区间 [replayEnd, ...) 天然首尾相接
       */
      // 1) 回放阶段
      const replayEnd = run.blocks.length;
      for (let i = Math.max(0, cursor); i < replayEnd; i++) {
        yield run.blocks[i];
      }

      // 2) 增量阶段
      while (true) {
        while (pending.length > 0) {
          const block = pending.shift() as ContentBlock;
          yield block;
        }
        if (ended) break;
        await new Promise<void>((res) => {
          resolveNext = res;
        });
      }

      if (error) throw error;
    } finally {
      subscription.unsubscribe();
    }
  }

  /**
   * Run 的实际执行体：驱动 agentService.stream()，把产出的 block 写入缓冲区并广播。
   * 完整跑完（成功 / 异常）后置终态，标记 finishedAt 供 GC。
   */
  private async execute(run: AgentRun, input: { message: string; sessionId: string }): Promise<void> {
    try {
      let emittedBlockCount = 0;
      let lastUsage: AgentInvokeResult['usage'] | undefined;

      for await (const chunk of this.agentService.stream({
        message: input.message,
        sessionId: input.sessionId,
      })) {
        const allBlocks: ContentBlock[] = messagesToBlocks(chunk.messages);
        const newBlocks = allBlocks.slice(emittedBlockCount);
        emittedBlockCount = allBlocks.length;

        for (const block of newBlocks) {
          this.pushBlock(run, block);
        }
        if (chunk.usage) lastUsage = chunk.usage;
      }

      if (lastUsage) {
        this.pushBlock(run, {
          type: 'usage',
          inputTokens: lastUsage.inputTokens,
          outputTokens: lastUsage.outputTokens,
          totalTokens: lastUsage.totalTokens,
          llmCalls: lastUsage.llmCalls,
          model: lastUsage.model,
        });
      }
      this.pushBlock(run, { type: 'done' });

      run.status = 'done';
      run.finishedAt = Date.now();
      run.subject.complete();
    } catch (err) {
      run.status = 'error';
      run.error = (err as Error).message;
      run.finishedAt = Date.now();
      this.logger.error(`run ${run.runId} 执行失败: ${run.error}`);
      run.subject.error(err);
    }
  }

  /** 顺序：先落缓冲，再广播；订阅方据此保证不重复不遗漏 */
  private pushBlock(run: AgentRun, block: ContentBlock): void {
    run.blocks.push(block);
    run.subject.next(block);
  }

  /** 定期清理超过 TTL 的已结束 run，避免内存无限增长 */
  private gc(): void {
    const now = Date.now();
    for (const [id, run] of this.activeRuns) {
      if (run.status === 'running') continue;
      if (run.finishedAt && now - run.finishedAt > FINISHED_RUN_TTL_MS) {
        this.activeRuns.delete(id);
      }
    }
  }
}

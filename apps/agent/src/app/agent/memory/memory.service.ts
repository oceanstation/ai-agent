import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { loadMemoryConfig, type MemoryConfig } from './memory.config';
import { MEMORY_FLUSH_SYSTEM_PROMPT } from '../config/system-prompt';
import { LlmService } from '../llm/llm.service';
import type {
  FlushInput,
  FlushResult,
  MemoryContext,
  MemoryMessage,
  MemoryScope,
} from './memory.types';

/**
 * MemoryService：记忆系统的核心服务。
 *
 * 提供三类能力：
 *   1) 读：常青记忆 + 最近 N 天日志 → 拼装进 system prompt
 *   2) 写：追加常青记忆 / 追加当日日志
 *   3) Flush：把最近一段对话用 LLM 提炼后追加到当日日志
 *
 * 所有失败路径都会 warn + 返回空/默认值，绝不阻塞主对话流程。
 */
@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);
  private readonly config: MemoryConfig;

  /** 单进程内的写锁，避免同一文件的并发追加交叉，实现“异步任务串行化（队列化）”的经典写法 */
  private writeChain: Promise<void> = Promise.resolve();

  /** 攒够 N 轮再 flush 的计数器（进程内，重启即清零） */
  private pendingTurns = 0;

  /** 用于 Flush 摘要的 LLM 客户端；未配置 fast 档时为 null */
  private readonly summarizer: ChatOpenAI | null;

  constructor(
    configService: ConfigService,
    private readonly llmService: LlmService,
  ) {
    this.config = loadMemoryConfig(configService);
    this.summarizer = this.llmService.get('fast');
  }

  // ===================== 读 =====================

  /** 读取 MEMORY.md 全文；不存在时返回空串 */
  async loadEvergreen(): Promise<string> {
    return this.safeRead(this.config.evergreenFile);
  }

  /** 读取指定日期的日志；不存在时返回空串 */
  async loadDaily(date: Date = new Date()): Promise<string> {
    return this.safeRead(this.dailyFilePath(date));
  }

  /**
   * 读取最近 N 天日志并按时间倒序拼接（今天在最前）。
   * 若某天文件不存在则跳过。
   */
  async loadRecentDaily(days = this.config.recentDays): Promise<string> {
    const now = new Date();
    const parts: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const content = await this.safeRead(this.dailyFilePath(d));
      if (content.trim()) {
        parts.push(`# ${formatDate(d)}\n${content.trim()}`);
      }
    }
    return parts.join('\n\n');
  }

  /** 构建供 system prompt 使用的记忆上下文 */
  async buildContext(days = this.config.recentDays): Promise<MemoryContext> {
    const [evergreen, recentDaily] = await Promise.all([
      this.loadEvergreen(),
      this.loadRecentDaily(days),
    ]);
    return { evergreen: evergreen.trim(), recentDaily };
  }

  // ===================== 写 =====================

  /** 向 MEMORY.md 追加一条常青记忆（自动补时间戳） */
  async appendEvergreen(entry: string): Promise<void> {
    const trimmed = entry.trim();
    if (!trimmed) return;
    const block = `\n<!-- ${new Date().toISOString()} -->\n${trimmed}\n`;
    await this.serializedAppend(this.config.evergreenFile, block);
  }

  /** 向当日日志追加一段内容（自动补 HH:mm:ss 二级标题） */
  async appendDaily(entry: string, date: Date = new Date()): Promise<void> {
    const trimmed = entry.trim();
    if (!trimmed) return;
    const header = `\n## ${formatTime(date)}\n`;
    await this.serializedAppend(
      this.dailyFilePath(date),
      `${header}${trimmed}\n`,
    );
  }

  /** 统一入口：按 scope 写入 */
  async append(scope: MemoryScope, content: string): Promise<void> {
    if (scope === 'evergreen') return this.appendEvergreen(content);
    return this.appendDaily(content);
  }

  // ===================== Flush =====================

  /**
   * 递增轮次计数并判断是否需要触发一次 Flush。
   *
   * @returns 若已触发返回 FlushResult，否则返回 null
   */
  async tick(input: FlushInput): Promise<FlushResult | null> {
    if (!this.config.flushEnabled) return null;
    this.pendingTurns += 1;
    if (this.pendingTurns < this.config.flushEveryTurns) {
      this.logger.debug(
        `Memory tick: ${this.pendingTurns}/${this.config.flushEveryTurns}，未达阈值`,
      );
      return null;
    }
    this.pendingTurns = 0;
    return this.flush(input);
  }

  /**
   * 立即执行一次 Flush：用摘要 LLM 从消息中提炼要点并追加到当日日志。
   * 提炼结果为空串时视为"无值得记忆"，不写文件。
   */
  async flush(input: FlushInput): Promise<FlushResult> {
    const file = this.dailyFilePath(new Date());
    const empty: FlushResult = { written: false, file, summary: '' };

    if (!this.summarizer) {
      this.logger.debug('未配置 LLM_FAST_API_KEY，跳过 Memory Flush');
      return empty;
    }
    if (input.messages.length < this.config.flushMinMessages) {
      return empty;
    }

    let summary = '';
    try {
      summary = await this.summarize(input.messages);
    } catch (err) {
      this.logger.warn(`Memory Flush 摘要失败：${(err as Error).message}`);
      return empty;
    }

    if (!summary.trim()) return empty;

    const sessionTag = input.sessionId ? ` session=${input.sessionId}` : '';
    const entry = `<!--${sessionTag} -->\n${summary.trim()}`;
    await this.appendDaily(entry);
    this.logger.log(`Memory Flush 已写入 ${file}`);
    return { written: true, file, summary };
  }

  /** 暴露配置只读视图，供外部/工具查询路径等 */
  getConfig(): Readonly<MemoryConfig> {
    return this.config;
  }

  // ===================== 私有辅助 =====================
  private async summarize(messages: MemoryMessage[]): Promise<string> {
    if (!this.summarizer) return '';
    const transcript = messages
      .map((m) => `[${m.role}] ${m.content}`.trim())
      .filter((line) => line.length > 0)
      .join('\n');

    const system = new SystemMessage(MEMORY_FLUSH_SYSTEM_PROMPT);
    const human = new HumanMessage(`对话内容如下：\n${transcript}`);

    const res = await this.summarizer.invoke([system, human]);
    return typeof res.content === 'string' ? res.content : (res.text ?? '');
  }

  /** 串行化 append，避免同一文件多请求并发写入交错 */
  private serializedAppend(file: string, content: string): Promise<void> {
    const next = this.writeChain.then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.appendFile(file, content, 'utf-8');
    });
    // 无论成败都要让链条继续；错误由本次调用方感知
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  private async safeRead(file: string): Promise<string> {
    try {
      return await fs.readFile(file, 'utf-8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        this.logger.warn(`读取记忆文件失败 ${file}: ${(err as Error).message}`);
      }
      return '';
    }
  }

  private dailyFilePath(date: Date): string {
    return path.join(this.config.dailyDir, `${formatDate(date)}.md`);
  }
}

/** yyyy-mm-dd（本地时区） */
function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** HH:mm:ss（本地时区） */
function formatTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

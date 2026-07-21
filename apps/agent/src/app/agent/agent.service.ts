import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { createDeepAgent } from 'deepagents';
import type { BaseMessage } from '@langchain/core/messages';
import { createSearchTool } from './tools/search.tool';
import { createReadMemoryTool } from './tools/read-memory.tool';
import { createWriteMemoryTool } from './tools/write-memory.tool';
import { buildSystemPrompt } from './config/system-prompt';
import { MemoryService } from './memory/memory.service';
import type { MemoryMessage } from './memory/memory.types';
import { extractMessageText } from './agent.types';
import type { AgentInvokeResult } from './agent.types';

@Injectable()
export class AgentService implements OnModuleInit {
  private readonly logger = new Logger(AgentService.name);

  /** 每次 stream 前根据最新 memory 上下文重建，避免"重启才生效"问题 */
  private baseTools: ReturnType<typeof createSearchTool>[] = [];
  private baseModel: ChatOpenAI | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly memoryService: MemoryService,
  ) {}

  onModuleInit(): void {
    const deepseekKey = this.configService.get<string>('DEEPSEEK_API_KEY');
    if (!deepseekKey) {
      this.logger.warn('未检测到 DEEPSEEK_API_KEY，AgentService 将不可用');
      return;
    }

    const baseURL = this.configService.get<string>('DEEPSEEK_API_URL');
    const deepseekModel = this.configService.get<string>('DEEPSEEK_MODEL');
    const tavilyKey = this.configService.get<string>('TAVILY_API_KEY');

    // 通用工具：搜索 + 记忆读写
    const tools: ReturnType<typeof createSearchTool>[] = [];
    if (tavilyKey) {
      tools.push(createSearchTool(tavilyKey));
    } else {
      this.logger.warn('未检测到 TAVILY_API_KEY，搜索工具将不可用');
    }
    // read_memory / write_memory 与 search 工具的签名不一致，用 as any 兜底避免过度约束类型
    tools.push(
      createReadMemoryTool(this.memoryService) as never,
      createWriteMemoryTool(this.memoryService) as never,
    );

    this.baseModel = new ChatOpenAI({
      model: deepseekModel,
      temperature: 0,
      apiKey: deepseekKey,
      configuration: { baseURL },
    });
    this.baseTools = tools;

    this.logger.log('AgentService 初始化完成（含 Memory 子系统）');
  }

  /** 守卫函数：确保依赖已初始化 */
  private ensureReady() {
    if (!this.baseModel) {
      throw new Error('Agent 尚未初始化，请检查 DEEPSEEK_API_KEY 是否配置');
    }
    return this.baseModel;
  }

  /**
   * 每次调用前根据最新 Memory 上下文构建一个新的 DeepAgent 实例。
   *
   * 之所以不复用全局单例：MEMORY.md 允许用户手动编辑，
   * 每次调用重建可以让改动 **无需重启进程即生效**。
   * 重建开销主要是拼字符串 + 构造对象，忽略不计。
   */
  private async createAgentWithMemory() {
    const model = this.ensureReady();
    const ctx = await this.memoryService.buildContext();
    const systemPrompt = buildSystemPrompt(ctx);
    return createDeepAgent({
      model,
      tools: this.baseTools,
      systemPrompt,
    });
  }

  /**
   * 流式调用 agent，逐步返回 state 快照。
   *
   * streamMode: "values" —— 每次 yield 一份完整的 state（含最新 messages），
   * 便于消费方直接取最后一条消息渲染，无需自己合并增量。
   */
  async *stream(message: string): AsyncGenerator<AgentInvokeResult> {
    const agent = await this.createAgentWithMemory();
    const iterable = await agent.stream(
      { messages: [{ role: 'user', content: message }] },
      { streamMode: 'values' },
    );
    let lastChunk: AgentInvokeResult | null = null;
    for await (const chunk of iterable) {
      lastChunk = chunk as AgentInvokeResult;
      yield lastChunk;
    }
    // 流结束后再尝试 flush，不影响 SSE 观察者
    if (lastChunk) {
      void this.tryFlush(message, lastChunk);
    }
  }

  /**
   * 会话结束尝试触发 Memory Flush（攒够 N 轮才真正执行）。
   * 任何异常都在此吞掉，绝不阻塞主流程。
   */
  private async tryFlush(userInput: string, result: AgentInvokeResult): Promise<void> {
    try {
      const messages: MemoryMessage[] = [
        { role: 'user', content: userInput },
        ...result.messages.map((m) => this.toMemoryMessage(m)),
      ].filter((m) => m.content.trim().length > 0);

      await this.memoryService.tick({ messages });
    } catch (err) {
      this.logger.warn(`Memory tick 失败：${(err as Error).message}`);
    }
  }

  private toMemoryMessage(msg: BaseMessage): MemoryMessage {
    const type =
      (msg as { getType?: () => string }).getType?.() ?? 'assistant';
    const role: MemoryMessage['role'] =
      type === 'human'
        ? 'user'
        : type === 'ai'
          ? 'assistant'
          : type === 'tool'
            ? 'tool'
            : 'system';
    return { role, content: extractMessageText(msg) };
  }
}

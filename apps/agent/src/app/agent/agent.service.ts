import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BaseMessage } from '@langchain/core/messages';
import { buildBaseTools } from './tools';
import { buildSystemPrompt } from './config/system-prompt';
import { loadMcpConfig, type McpConfig } from './config/mcp.config';
import { LlmService, type ModelTier } from './llm/llm.service';
import { IntentRouterService } from './llm/intent-router.service';
import { MemoryService } from './memory/memory.service';
import type { MemoryMessage } from './memory/memory.types';
import { HistoryService } from './history/history.service';
import { SddService } from './sdd/sdd.service';
import { SkillService } from './skills/skill.service';
import { WorkspaceService } from './workspace/workspace.service';
import { extractMessageText, sumTokenUsage } from './agent.types';
import type { AgentInvokeResult } from './agent.types';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { createAgent } from 'langchain';
import { trimMessagesByTokenBudget, type ChatMessageLite } from './utils/token-counter';
import { parseIntSafe } from './utils/config-parse';

/** Agent 执行输入：文本消息 + 可选的会话上下文 */
export interface AgentStreamInput {
  message: string;
  /** 前端维护的会话 ID；用于加载历史消息并写回本轮对话 */
  sessionId?: string;
}

@Injectable()
export class AgentService implements OnModuleInit {
  private readonly logger = new Logger(AgentService.name);

  private mcpConfig: McpConfig = { enabled: false, client: { mcpServers: {} } };

  constructor(
    private readonly configService: ConfigService,
    private readonly llmService: LlmService,
    private readonly intentRouter: IntentRouterService,
    private readonly memoryService: MemoryService,
    private readonly historyService: HistoryService,
    private readonly skillService: SkillService,
    private readonly workspaceService: WorkspaceService,
    private readonly sddService: SddService,
  ) {}

  onModuleInit(): void {
    if (!this.llmService.get('fast')) {
      this.logger.warn('fast 档模型未配置，AgentService 将不可用');
      return;
    }
    this.mcpConfig = loadMcpConfig(this.configService);
  }

  /** 守卫函数：确保 fast 档模型已配置 */
  private ensureReady() {
    const fast = this.llmService.get('fast');
    if (!fast) {
      throw new Error('Agent 尚未初始化，请检查 LLM_FAST_API_KEY 是否配置');
    }
    return fast;
  }

  /**
   * 每次调用前根据最新 Memory 上下文构建一个新的 Agent 实例（langchain 的 createAgent）。
   *
   * 之所以不复用全局单例：MEMORY.md 允许用户手动编辑，
   * 每次调用重建可以让改动 **无需重启进程即生效**。
   * 重建开销主要是拼字符串 + 构造对象，忽略不计。
   *
   * `tier` 决定本轮使用哪档模型：由 stream() 侧的路由器决定。
   * `sessionId` 用于文件工具的会话隔离（见 WorkspaceService.forSession）。
   */
  private async createAgent(tier: ModelTier, sessionId?: string) {
    const model = this.llmService.get(tier) ?? this.ensureReady();

    // 会话文件隔离：确保该 session 的工作目录存在，并按 session 装配文件类工具。
    await this.workspaceService.ensureSessionRoot(sessionId);
    // 工具随 session 绑定
    const tools = buildBaseTools(
      {
        memoryService: this.memoryService,
        skillService: this.skillService,
        workspaceService: this.workspaceService,
        sddService: this.sddService,
      },
      sessionId,
    );

    // 组织 systemPrompt
    const ctx = await this.memoryService.buildContext();
    const skills = this.skillService.list(); // Skill 元数据（渐进式披露）
    const workspace = this.workspaceService.getConfig();
    const sddView = await this.sddService.buildContext();
    const systemPrompt = buildSystemPrompt(ctx, skills, workspace, sddView);

    // MCP 工具列表
    let mcpTools: Awaited<ReturnType<MultiServerMCPClient['getTools']>> = [];
    if (this.mcpConfig.enabled) {
      const client = new MultiServerMCPClient(this.mcpConfig.client);
      mcpTools = await client.getTools();
    }

    return createAgent({
      model,
      systemPrompt,
      tools: [...tools, ...mcpTools],
    });
  }

  /**
   * 流式调用 agent，逐步返回 state 快照。
   *
   * streamMode: "values" —— 每次 yield 一份完整的 state（含最新 messages），
   * 便于消费方直接取最后一条消息渲染，无需自己合并增量。
   *
   * 若传入 sessionId：
   *   1) 会先从 SQLite 加载该 session 的历史消息，一并送给 LLM，实现多轮对话；
   *   2) 结束后把本轮用户输入与 assistant 消息写回 SQLite，供下次继续与前端回放使用。
   */
  async *stream(input: AgentStreamInput): AsyncGenerator<AgentInvokeResult> {
    // 通过意图识别决定本轮使用哪档模型；异常/未配置时会回退 fast
    const tier: ModelTier = await this.intentRouter.route(input.message);

    const historyMessages = input.sessionId
      ? this.loadHistoryAsChatMessages(input.sessionId)
      : [];

    const agent = await this.createAgent(tier, input.sessionId);

    // 1) 拼装消息序列：历史 + 本轮 user
    const messages: [ 'user' | 'assistant', string ][] = [
      ...historyMessages.map(
        (m) => [m.role, m.content] as ['user' | 'assistant', string],
      ),
      ['user', input.message],
    ];

    // streamMode: "values" 下每个 chunk 是"完整 state 快照"，会把我们传入的
    // historyMessages 也一并回带。为避免下游（SSE 下发 / SQLite 持久化 / Memory Flush）
    // 把历史消息误当作"本轮新消息"重复处理，这里记录基线长度，yield 时统一切片，
    // 只暴露本轮真正新增的 messages。
    //
    // 注意：本轮的 user 消息也在基线内（historyMessages.length + 1），因此不会被
    // 再次写回 DB —— persistTurn 会单独用 input.message 落库 user 侧。
    const baseline = historyMessages.length + 1;
    const recursionLimit = parseIntSafe(
      this.configService.get<string>('AGENT_RECURSION_LIMIT'),
      100,
    );

    const iterable = await agent.stream(
      { messages },
      { streamMode: 'values', recursionLimit },
    );
    let lastChunk: AgentInvokeResult | null = null;
    for await (const chunk of iterable) {
      const full = chunk as AgentInvokeResult;
      const turnOnly: AgentInvokeResult = {
        ...full,
        messages: full.messages.slice(baseline),
      };
      lastChunk = turnOnly;
      yield turnOnly;
    }

    // 2) 收尾：统计 token 用量 + 写回 SQLite + 触发 Memory Flush
    if (lastChunk) {
      const usage = sumTokenUsage(lastChunk.messages);
      usage.model = this.llmService.get(tier)?.model;
      lastChunk.usage = usage;

      yield { messages: [], usage } satisfies AgentInvokeResult;

      if (input.sessionId) {
        this.persistTurn(input.sessionId, input.message, lastChunk);
      }
      void this.tryFlush(input.message, lastChunk);
    }
  }

  /**
   * 从 SQLite 加载指定会话的历史，转成 LangChain 可接受的 role/content 数组。
   *
   * 只回放 user / assistant 两类消息给 LLM：
   * - tool 消息与 tool_use 是 LangChain 内部结构，直接注入反而会破坏 chat 顺序；
   * - system 消息由 buildSystemPrompt 每次动态注入，不需要从 DB 恢复。
   *
   * **上下文压缩（Step 1）**：全量历史会随会话线性增长，直接塞给 LLM 会撞窗口上限，
   * 因此这里按 token 预算做"滑动窗口"裁剪 —— 从最新一条向前累加，超预算即停止，
   * 保留最近若干轮原文；更老的对话本轮直接丢弃（后续步骤会用摘要来补偿）。
   */
  private loadHistoryAsChatMessages(sessionId: string): ChatMessageLite[] {
    try {
      const rows = this.historyService.getMessages(sessionId);
      const all: ChatMessageLite[] = rows
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .filter((m) => m.content.trim().length > 0)
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

      const { messages, keptTokens, dropped } = trimMessagesByTokenBudget(all);
      if (dropped > 0) {
        this.logger.warn(`${sessionId}：保留 ${keptTokens} tokens，丢弃 ${dropped} 条消息`);
      }
      return messages;
    } catch (err) {
      this.logger.warn(`${sessionId}: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * 把本轮 user 输入与 assistant 产出的所有消息（含 tool）写回 SQLite。
   *
   * 注意：`result.messages` 已由 stream() 内部按 baseline 切片，
   * 只包含本轮真正新增的 AI / Tool 消息，历史部分不会再次入库。
   */
  private persistTurn(
    sessionId: string,
    userInput: string,
    result: AgentInvokeResult,
  ): void {
    try {
      // 写入用户消息
      this.historyService.appendMessage({
        sessionId,
        role: 'user',
        content: userInput,
      });

      for (const msg of result.messages) {
        const type =
          (msg as { getType?: () => string }).getType?.() ?? '';
        if (type === 'ai') {
          const text = extractMessageText(msg).trim();
          if (!text) continue;
          this.historyService.appendMessage({
            sessionId,
            role: 'assistant',
            content: text,
          });
        } else if (type === 'tool') {
          const text = extractMessageText(msg).trim();
          if (!text) continue;
          const toolName =
            (msg as unknown as { name?: string }).name ?? null;
          this.historyService.appendMessage({
            sessionId,
            role: 'tool',
            content: text,
            toolName,
          });
        }
      }
    } catch (err) {
      this.logger.warn(`写入对话历史失败: ${(err as Error).message}`);
    }
  }

  /**
   * 会话结束尝试触发 Memory Flush（攒够 N 轮才真正执行）。
   * 任何异常都在此吞掉，绝不阻塞主流程。
   */
  private async tryFlush(userInput: string, result: AgentInvokeResult): Promise<void> {
    try {
      const userMsg: MemoryMessage = { role: 'user', content: userInput };
      const messages: MemoryMessage[] = [
        userMsg,
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

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { createDeepAgent } from 'deepagents';
import { createSearchTool } from './tools/search.tool';
import { SYSTEM_PROMPT } from './config/system-prompt';
import type { AgentInvokeResult } from './agent.types';

@Injectable()
export class AgentService implements OnModuleInit {
  private readonly logger = new Logger(AgentService.name);
  private agent: Awaited<ReturnType<typeof createDeepAgent>> | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const deepseekKey = this.configService.get<string>('DEEPSEEK_API_KEY');
    if (!deepseekKey) {
      this.logger.warn('未检测到 DEEPSEEK_API_KEY，AgentService 将不可用');
      return;
    }

    const baseURL = this.configService.get<string>('DEEPSEEK_API_URL');
    const deepseekModel = this.configService.get<string>('DEEPSEEK_MODEL');
    const tavilyKey = this.configService.get<string>('TAVILY_API_KEY');

    // 按需构建工具列表
    const tools = [];
    if (tavilyKey) {
      tools.push(createSearchTool(tavilyKey));
    } else {
      this.logger.warn('未检测到 TAVILY_API_KEY，搜索工具将不可用');
    }

    const model = new ChatOpenAI({
      model: deepseekModel,
      temperature: 0,
      apiKey: deepseekKey,
      configuration: { baseURL },
    });

    this.agent = createDeepAgent({
      model,
      tools,
      systemPrompt: SYSTEM_PROMPT,
    });

    this.logger.log('DeepAgent 初始化完成');
  }

  /**
   * 守卫函数：确保 agent 已初始化，否则抛出明确错误。
   * 返回非空的 agent 实例，调用方无需再做 null 检查。
   */
  private ensureAgent() {
    if (!this.agent) {
      throw new Error(
        'Agent 尚未初始化，请检查 DEEPSEEK_API_KEY 是否配置',
      );
    }
    return this.agent;
  }

  /**
   * 执行一次 agent 调用
   * @param message 用户输入
   */
  async invoke(message: string): Promise<AgentInvokeResult> {
    const agent = this.ensureAgent();

    return (await agent.invoke({
      messages: [{ role: 'user', content: message }],
    })) as AgentInvokeResult;
  }

  /**
   * 流式调用 agent，逐步返回 state 快照。
   *
   * streamMode: "values" —— 每次 yield 一份完整的 state（含最新 messages），
   * 便于消费方直接取最后一条消息渲染，无需自己合并增量。
   */
  async *stream(message: string): AsyncGenerator<AgentInvokeResult> {
    const agent = this.ensureAgent();
    const iterable = await agent.stream(
      { messages: [{ role: 'user', content: message }] },
      { streamMode: 'values' },
    );
    for await (const chunk of iterable) {
      yield chunk as AgentInvokeResult;
    }
  }
}

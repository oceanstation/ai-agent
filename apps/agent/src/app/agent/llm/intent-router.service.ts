import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { LlmService, type ModelTier } from './llm.service';

/**
 * 意图路由：用 fast 档模型做一次轻量二分类，决定本轮使用 fast 还是 pro。
 *
 * - 未配置 `LLM_PRO_MODEL` 或任何异常 → 一律回退 fast，不阻塞主流程。
 * - Prompt 强约束"只输出单词"，避免额外 token 开销。
 */
@Injectable()
export class IntentRouterService {
  private readonly logger = new Logger(IntentRouterService.name);

  private static readonly SYSTEM_PROMPT = [
    '你是意图路由器，只输出一个单词：fast 或 pro，不要输出任何其他内容。',
    '- pro：需要深度推理 / 复杂规划 / 跨文件重构 / 疑难排查 / 长文档理解 / 规范驱动开发（sdd）。',
    '- fast：日常问答 / 简单代码改动 / 查询 / 闲聊。',
    '不确定时输出 fast。',
  ].join('\n');

  constructor(
    private readonly llmService: LlmService,
    private readonly configService: ConfigService,
  ) {}

  /** 根据用户输入决定本轮 tier；pro 档不可用或异常时回退 fast。 */
  async route(userInput: string): Promise<ModelTier> {
    if (!this.configService.get<string>('LLM_PRO_MODEL')) return 'fast';

    const model = this.llmService.get('fast');
    if (!model) return 'fast';

    try {
      const res = await model.invoke([
        new SystemMessage(IntentRouterService.SYSTEM_PROMPT),
        new HumanMessage(userInput),
      ]);
      const tier: ModelTier = res.text.toLowerCase().includes('pro')
        ? 'pro'
        : 'fast';
      this.logger.debug(`intent -> ${tier}`);
      return tier;
    } catch (err) {
      this.logger.warn(`意图识别失败，回退 fast：${(err as Error).message}`);
      return 'fast';
    }
  }
}

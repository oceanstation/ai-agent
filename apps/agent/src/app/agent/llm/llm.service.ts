import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';

/**
 * 模型分层：不同 tier 对应不同能力 / 成本组合。
 *   - fast：默认对话 / Memory Flush / search subagent
 *   - pro：需要深度推理的场景
 */
export type ModelTier = 'fast' | 'pro';

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly cache = new Map<ModelTier, ChatOpenAI>();

  constructor(private readonly configService: ConfigService) {}

  get(tier: ModelTier): ChatOpenAI | null {
    const cached = this.cache.get(tier);
    if (cached) return cached;

    const apiKey = this.configService.get<string>('LLM_FAST_API_KEY');
    if (!apiKey) return null; // 调用方需自行判空：或抛错、或降级

    const fastModel = this.configService.get<string>('LLM_FAST_MODEL');
    const proModel = this.configService.get<string>('LLM_PRO_MODEL');

    if (tier === 'pro' && !proModel) {
      this.logger.warn('未配置 LLM_PRO_MODEL，pro 档回退到 LLM_FAST_MODEL');
    }

    const inst = new ChatOpenAI({
      model: tier === 'pro' ? (proModel ?? fastModel) : fastModel,
      temperature: 0,
      apiKey,
      useResponsesApi: true,
      configuration: {
        baseURL: this.configService.get<string>('LLM_FAST_API_URL'),
      },
    });
    this.cache.set(tier, inst);
    return inst;
  }
}

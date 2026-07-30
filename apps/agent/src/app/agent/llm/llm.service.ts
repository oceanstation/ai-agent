import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';

/**
 * 模型分层：不同 tier 对应不同能力 / 成本组合。
 *   - fast：默认对话 / Memory Flush / search subagent
 *   - pro：需要深度推理的场景（如 SDD 四阶段）
 *
 * 新增 tier：把它加入联合类型，`.env.example` 里补一组 `LLM_<TIER>_*` 环境变量即可。
 */
export type ModelTier = 'fast' | 'pro';

/**
 * LlmService：按 tier 惰性构造 ChatOpenAI，同一 tier 复用同一个实例。
 *
 * 环境变量约定：`LLM_<TIER>_API_KEY / _API_URL / _MODEL`。
 * fast 是"基线档"：所有 tier 若某字段缺失都会从 fast 补齐，因此只要 fast 填全，
 * 新档只需最少补一个 `LLM_<TIER>_MODEL` 即可启用。
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly cache = new Map<ModelTier, ChatOpenAI>();

  constructor(private readonly configService: ConfigService) {}

  /**
   * 拿指定 tier 的模型实例；未配置且非 fast 时降级到 fast，仍无则返回 null。
   * 调用方遇 null 时应视为"未初始化"，走守卫报错。
   */
  get(tier: ModelTier): ChatOpenAI | null {
    const cached = this.cache.get(tier);
    if (cached) return cached;

    const apiKey =
      this.env(tier, 'API_KEY') ??
      (tier === 'pro' ? this.env('fast', 'API_KEY') : undefined);
    if (!apiKey) {
      if (tier !== 'fast') {
        this.logger.warn(`tier "${tier}" 未配置，降级到 fast`);
        return this.get('fast');
      }
      return null;
    }

    const inst = new ChatOpenAI({
      model:
        this.env(tier, 'MODEL') ??
        (tier === 'pro' ? this.env('fast', 'MODEL') : undefined),
      temperature: 0,
      apiKey,
      configuration: {
        baseURL:
          this.env(tier, 'API_URL') ??
          (tier === 'pro' ? this.env('fast', 'API_URL') : undefined),
      },
    });
    this.cache.set(tier, inst);
    return inst;
  }

  /** 读取 `LLM_<TIER>_<KEY>`；未配置返回 undefined。 */
  private env(tier: ModelTier, key: string): string | undefined {
    const v = this.configService.get<string>(
      `LLM_${tier.toUpperCase()}_${key}`,
    );
    return v && v.trim() ? v : undefined;
  }
}

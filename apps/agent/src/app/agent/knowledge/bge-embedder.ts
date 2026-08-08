import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  pipeline,
  env,
  type FeatureExtractionPipeline,
} from '@huggingface/transformers';
import { loadKnowledgeConfig } from './knowledge.config';

/**
 * 本地中文 bge 嵌入器（**仅查询用**）
 *
 * - agent 侧只负责把用户 query 编码成向量，交给 Chroma Cloud 做检索；
 *   入库在仓库外通过独立脚本完成，agent 与入库端须使用同一模型 ID，
 *   保证维度一致（bge-base=768）；
 * - 首次调用会下载 ONNX 模型到 `env.cacheDir`（由 KnowledgeConfig.hfCacheDir 决定），
 *   之后完全离线；
 * - 通过 lazy pipeline 保证服务启动不因大模型加载而阻塞；
 * - 输出经 mean pooling + L2 归一化，符合 bge 官方推荐用法。
 *
 * 实现 chromadb `EmbeddingFunction` 接口的必需方法 `generate(texts)`；
 * 未实现的 `generateForQueries` 会由 chroma 客户端自动 fallback 到 `generate`。
 */
@Injectable()
export class BgeEmbedder {
  private readonly logger = new Logger(BgeEmbedder.name);

  /**
   * 中文 bge 模型（HuggingFace ONNX，transformers.js 可直接加载）
   *
   * **必须与入库端使用的模型保持一致**（可通过环境变量 `BGE_MODEL_ID` 覆盖），
   * 否则集合的向量维度会不匹配（bge-base=768，bge-small=512），
   * chroma 会以 "expecting embedding with dimension of X, got Y" 报错。
   */
  private readonly modelId: string;

  private extractor: FeatureExtractionPipeline | null = null;
  private loading: Promise<FeatureExtractionPipeline> | null = null;

  constructor(configService: ConfigService) {
    const cfg = loadKnowledgeConfig(configService);
    this.modelId = cfg.bgeModelId;

    // 统一到 KnowledgeConfig.hfCacheDir（可由 AGENT_DATA_DIR / HF_CACHE_DIR 决定），
    // 与入库端共享同一份模型缓存以避免重复下载。
    env.cacheDir = cfg.hfCacheDir;
    // 允许自动下载（cacheDir 里缺文件时从 HuggingFace 拉）。
    // 桌面打包首启动时 userData/.models 是空的，靠这里自动下载 ~400MB BGE 模型；
    // 完全离线场景可设 `ALLOW_REMOTE_MODELS=false` 强制只用本地。
    env.allowRemoteModels =
      configService.get<string>('ALLOW_REMOTE_MODELS') !== 'false';
  }

  private async getExtractor(): Promise<FeatureExtractionPipeline> {
    if (this.extractor) return this.extractor;
    if (!this.loading) {
      this.logger.log(`Loading embedding model: ${this.modelId}`);
      this.loading = pipeline('feature-extraction', this.modelId, {
        device: 'cpu',
      });
    }
    this.extractor = await this.loading;
    this.logger.log(`Embedding model ready: ${this.modelId}`);
    return this.extractor;
  }

  async generate(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extractor = await this.getExtractor();
    const output = await extractor(texts, {
      pooling: 'mean',
      normalize: true,
    });
    return output.tolist();
  }
}

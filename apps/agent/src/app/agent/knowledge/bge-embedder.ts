import { Injectable, Logger } from '@nestjs/common';
import { resolve } from 'node:path';
import {
  pipeline,
  env,
  type FeatureExtractionPipeline,
} from '@huggingface/transformers';

function resolveSharedCacheDir(): string {
  if (process.env.HF_CACHE_DIR) return process.env.HF_CACHE_DIR;
  return resolve(process.cwd(), '.models');
}

/**
 * 本地中文 bge 嵌入器（**仅查询用**）
 *
 * - agent 侧只负责把用户 query 编码成向量，交给 chromadb 做检索；
 *   入库由独立的 `@ai-agent/chroma` 应用负责，两侧共用同一份
 *   `.models/` 缓存目录，确保维度一致（bge-base=768）；
 * - 首次调用会下载 ONNX 模型到 `env.cacheDir`（默认仓库根 `.models/`），
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
   * **必须与 apps/chroma/bge-embedder.ts 的入库端保持一致**，
   * 否则集合的向量维度会不匹配（bge-base=768，bge-small=512），
   * chroma 会以 "expecting embedding with dimension of X, got Y" 报错。
   */
  private readonly modelId =
    process.env.BGE_MODEL_ID ?? 'Xenova/bge-base-zh-v1.5';

  private extractor: FeatureExtractionPipeline | null = null;
  private loading: Promise<FeatureExtractionPipeline> | null = null;

  constructor() {
    // 统一到仓库根 `.models/`，与 apps/chroma 共享同一份缓存
    env.cacheDir = resolveSharedCacheDir();
    env.allowRemoteModels = true;
  }

  private async getExtractor(): Promise<FeatureExtractionPipeline> {
    if (this.extractor) return this.extractor;
    if (!this.loading) {
      this.logger.log(`Loading embedding model: ${this.modelId}`);
      this.loading = pipeline('feature-extraction', this.modelId, {
        device: 'cpu',
      }) as Promise<FeatureExtractionPipeline>;
    }
    this.extractor = await this.loading;
    this.logger.log(`Embedding model ready: ${this.modelId}`);
    return this.extractor;
  }

  /** chromadb `EmbeddingFunction.generate`：把一批文本编码成向量 */
  async generate(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const model = await this.getExtractor();
    const output = await model(texts, {
      pooling: 'mean',
      normalize: true,
    });
    return output.tolist() as number[][];
  }
}

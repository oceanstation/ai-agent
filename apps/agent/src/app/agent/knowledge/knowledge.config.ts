import type { ConfigService } from '@nestjs/config';
import { resolveAgentPath } from '../../paths';

/**
 * Knowledge 子系统的运行时配置。
 *
 * 负责聚合 Chroma Cloud 连接参数 + 本地 embedding 模型参数，
 * 避免 KnowledgeService / BgeEmbedder 直接读 process.env。
 */
export interface KnowledgeConfig {
  /** Chroma Cloud API Key（必填，缺失时 KnowledgeService 会在首次查询时报错） */
  chromaApiKey: string;
  /** Chroma Cloud 租户 ID（tenant UUID） */
  chromaTenant: string;
  /** Chroma Cloud 数据库名 */
  chromaDatabase: string;
  /** Chroma 集合名（默认 cookbook） */
  chromaCollection: string;
  /** HuggingFace transformers 模型缓存目录（绝对路径） */
  hfCacheDir: string;
  /** bge 中文嵌入模型 ID（须与入库端一致） */
  bgeModelId: string;
}

const DEFAULT_BGE_MODEL_ID = 'Xenova/bge-base-zh-v1.5';

/**
 * 从 ConfigService 读取并归一化 Knowledge 配置。
 *
 * 独立函数便于单测中直接构造，无需启动 Nest 容器。
 *
 * hfCacheDir 路径解析优先级（见 apps/agent/src/app/paths.ts）：
 *   1. 显式 `HF_CACHE_DIR`；
 *   2. `AGENT_DATA_DIR/.models`；
 *   3. 兼容旧默认：仓库根下的 `.models`。
 */
export function loadKnowledgeConfig(
  configService: ConfigService,
): KnowledgeConfig {
  const hfCacheDir = resolveAgentPath(
    configService.get<string>('HF_CACHE_DIR'),
    '.models',
    '.models',
  );

  return {
    chromaApiKey: configService.get<string>('CHROMA_API_KEY') ?? '',
    chromaTenant:
      configService.get<string>('CHROMA_TENANT') ?? '',
    chromaDatabase:
      configService.get<string>('CHROMA_DATABASE') ?? '',
    chromaCollection:
      configService.get<string>('CHROMA_COLLECTION') ?? '',
    hfCacheDir,
    bgeModelId:
      configService.get<string>('BGE_MODEL_ID') ?? DEFAULT_BGE_MODEL_ID,
  };
}

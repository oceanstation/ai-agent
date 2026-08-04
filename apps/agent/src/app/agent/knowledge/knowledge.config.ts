import type { ConfigService } from '@nestjs/config';
import * as path from 'node:path';

/**
 * Knowledge 子系统的运行时配置。
 *
 * 负责聚合 Chroma 连接参数 + 本地 embedding 模型参数，
 * 避免 KnowledgeService / BgeEmbedder 直接读 process.env。
 */
export interface KnowledgeConfig {
  /** Chroma 连接：host（默认 localhost） */
  chromaHost: string;
  /** Chroma 连接：port（默认 8000） */
  chromaPort: number;
  /** Chroma 集合名（默认 cookbook，与 apps/chroma/ingest.ts 保持一致） */
  chromaCollection: string;
  /** HuggingFace transformers 模型缓存目录（绝对路径） */
  hfCacheDir: string;
  /** bge 中文嵌入模型 ID（须与入库端一致） */
  bgeModelId: string;
}

const DEFAULT_CHROMA_HOST = 'localhost';
const DEFAULT_CHROMA_PORT = 8000;
const DEFAULT_COLLECTION = 'cookbook';
const DEFAULT_HF_CACHE_DIR = '.models';
const DEFAULT_BGE_MODEL_ID = 'Xenova/bge-base-zh-v1.5';

/**
 * 从 ConfigService 读取并归一化 Knowledge 配置。
 *
 * 独立函数便于单测中直接构造，无需启动 Nest 容器。
 */
export function loadKnowledgeConfig(
  configService: ConfigService,
): KnowledgeConfig {
  const rawPort = configService.get<string>('CHROMA_PORT');
  const chromaPort = rawPort ? Number(rawPort) : DEFAULT_CHROMA_PORT;

  const rawCache =
    configService.get<string>('HF_CACHE_DIR') ?? DEFAULT_HF_CACHE_DIR;
  const hfCacheDir = path.isAbsolute(rawCache)
    ? rawCache
    : path.resolve(process.cwd(), rawCache);

  return {
    chromaHost:
      configService.get<string>('CHROMA_HOST') ?? DEFAULT_CHROMA_HOST,
    chromaPort,
    chromaCollection:
      configService.get<string>('CHROMA_COLLECTION') ?? DEFAULT_COLLECTION,
    hfCacheDir,
    bgeModelId:
      configService.get<string>('BGE_MODEL_ID') ?? DEFAULT_BGE_MODEL_ID,
  };
}

import { Injectable, Logger } from '@nestjs/common';
import { ChromaClient, type Collection, type Metadata } from 'chromadb';
import { BgeEmbedder } from './bge-embedder';

/** 入库阶段写入的元数据结构（在 chroma 官方 Metadata 基础上收敛常用字段） */
export type HitMetadata = Metadata & {
  source?: string;
  heading?: string;
  chunkIndex?: number;
};

export interface KnowledgeHit {
  /** 结果排序（1-based） */
  rank: number;
  /** 命中的文本片段 */
  document: string;
  /** 元数据（来源文件、标题等，来自入库阶段） */
  metadata: HitMetadata;
  /** chroma 返回的距离（越小越相似；bge 归一化后 ≈ 1 - cosine） */
  distance: number | null;
}

export interface QueryOptions {
  /** 查询文本，必填 */
  query: string;
  /** topK，默认 3，范围 1~20 */
  nResults?: number;
}

/**
 * 知识库查询服务
 *
 * - 惰性连接 Chroma：首次查询才建立连接与集合句柄，服务启动不受影响；
 * - 集合名与 apps/chroma/ingest.ts 保持一致（`cookbook`）；
 * - 依赖 Chroma 服务已经启动（`pnpm exec chroma run --path ./data`）。
 */
@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);
  private readonly collectionName = process.env.CHROMA_COLLECTION ?? 'cookbook';

  private client: ChromaClient | null = null;
  private collection: Collection | null = null;
  private connecting: Promise<Collection> | null = null;

  constructor(private readonly embedder: BgeEmbedder) {}

  /** 获取（或建立）到 chroma 集合的连接 */
  private async getCollection(): Promise<Collection> {
    if (this.collection) return this.collection;
    if (!this.connecting) {
      this.connecting = (async () => {
        this.client = new ChromaClient({
          host: process.env.CHROMA_HOST ?? 'localhost',
          port: Number(process.env.CHROMA_PORT ?? 8000),
        });
        const col = await this.client.getOrCreateCollection({
          name: this.collectionName,
          embeddingFunction: this.embedder,
        });
        this.logger.log(
          `Connected to Chroma collection: ${this.collectionName}`,
        );
        return col;
      })().catch((err) => {
        // 连接失败：清理缓存，允许下次请求重新建立连接（比如 chroma 后来才起来）
        this.connecting = null;
        this.client = null;
        throw err;
      });
    }
    this.collection = await this.connecting;
    return this.collection;
  }

  /** 查询知识库 */
  async query({ query, nResults }: QueryOptions): Promise<KnowledgeHit[]> {
    const q = (query ?? '').trim();
    if (!q) return [];
    const collection = await this.getCollection();
    const result = await collection.query<HitMetadata>({
      queryTexts: [q],
      nResults,
    });

    const rows = result.rows()[0] ?? [];
    return rows
      .filter((row) => row.document)
      .map<KnowledgeHit>((row, index) => ({
        rank: index + 1,
        document: row.document as string,
        metadata: row.metadata ?? {},
        distance: row.distance ?? null,
      }));
  }
}

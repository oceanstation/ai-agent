import { get } from './http';

/** 后端返回的一条命中记录，与 KnowledgeService.KnowledgeHit 对齐 */
export interface KnowledgeHit {
  rank: number;
  document: string;
  metadata: {
    source?: string;
    heading?: string;
    chunkIndex?: number;
    [key: string]: unknown;
  };
  distance: number | null;
}

export interface KnowledgeQueryResult {
  query: string;
  hits: KnowledgeHit[];
}

/**
 * 相似度检索知识库。
 * @param q       查询文本
 * @param n       topK，默认 3
 */
export function queryKnowledge(
  q: string,
  n?: number,
): Promise<KnowledgeQueryResult> {
  return get<KnowledgeQueryResult>('/knowledge/query', { q, n });
}

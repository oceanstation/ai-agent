import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { KnowledgeService, type KnowledgeHit } from './knowledge.service';

@Controller('agent/knowledge')
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  /**
   * 相似度检索
   * GET /agent/knowledge/query?q=xxx&n=3
   *
   * - `q` 必填；空串返回 400；
   * - `n` 可选，默认 3，范围 1~20；
   * - 命中列表带 rank / metadata / distance，前端可直接渲染。
   */
  @Get('query')
  async query(
    @Query('q') q?: string,
    @Query('n') n?: string,
  ): Promise<{ query: string; hits: KnowledgeHit[] }> {
    const query = (q ?? '').trim();
    if (!query) {
      throw new HttpException('query "q" is required', HttpStatus.BAD_REQUEST);
    }

    try {
      const hits = await this.knowledgeService.query({
        query,
        nResults: +(n || 3),
      });
      return { query, hits };
    } catch (err) {
      throw new HttpException(
        `knowledge query failed: ${(err as Error).message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

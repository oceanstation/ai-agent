import {
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Sse,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AgentService } from './agent.service';
import type { AgentInvokeResult } from './agent.types';
import { messagesToBlocks, type ContentBlock } from './agent.blocks';
import { HistoryService } from './history/history.service';
import type {
  HistoryMessage,
  HistorySearchHit,
  HistorySession,
} from './history/history.types';

@Controller('agent')
export class AgentController {
  constructor(
    private readonly agentService: AgentService,
    private readonly historyService: HistoryService,
  ) {}

  /**
 * 流式调用 Agent（SSE）—— Content Block 协议
   * GET /agent/invoke?message=...&sessionId=...
   *
   * - `sessionId` 可选：前端负责维护；未传时会自动新建一个 session，
   *   sessionId 通过首帧 `{ type: 'session', id }` 下发给前端持久化。
   * - 每条 SSE data 都是一个 ContentBlock，对齐 OpenAI / Anthropic Messages API 风格。
   */
  @Sse('invoke')
  stream(
    @Query('message') message: string,
    @Query('sessionId') sessionIdInput?: string,
  ): Observable<MessageEvent> {
    // 归一化 sessionId：前端传了就复用（校验存在性），否则新建
    const sessionId =
      sessionIdInput && this.historyService.hasSession(sessionIdInput)
        ? sessionIdInput
        : this.historyService.createSession().id;

    return new Observable<MessageEvent>((subscriber) => {
      let cancelled = false;

      // 首帧下发 session 元信息，前端据此持久化（例如写入 localStorage）
      subscriber.next({
        data: { type: 'session', id: sessionId } satisfies ContentBlock,
      });

      void (async () => {
        try {
          // 增量策略：memory 相关 tool_use 与 tool 结果需要跨消息才能识别归属，
          // 因此每个 chunk 到达时，先对**全量** messages 做过滤转换，得到当前
          // 应展示的 blocks 序列，再与已推数量 diff，只把新增部分推给前端。
          let emittedBlockCount = 0;

          const iterator: AsyncIterable<AgentInvokeResult> =
            this.agentService.stream({ message, sessionId });

          for await (const chunk of iterator) {
            if (cancelled) break;

            const allBlocks: ContentBlock[] = messagesToBlocks(chunk.messages);
            const newBlocks = allBlocks.slice(emittedBlockCount);
            emittedBlockCount = allBlocks.length;

            for (const block of newBlocks) {
              if (cancelled) break;
              subscriber.next({ data: block });
            }
          }

          if (!cancelled) {
            subscriber.next({ data: { type: 'done' } satisfies ContentBlock });
            subscriber.complete();
          }
        } catch (err) {
          subscriber.error(err);
        }
      })();

      // teardown：客户端断开时置位，让 for-await 提前退出
      return () => {
        cancelled = true;
      };
    });
  }

  // ===================== 会话历史 REST 接口 =====================

  /**
   * 新建一个空会话；前端"新建对话"按钮直接调用。
   * 之所以单独提供而非在 invoke 中懒建：允许前端在真正发出消息之前拿到 sessionId
   * 用于路由跳转、URL 记录等交互。
   */
  @Post('sessions')
  createSession(): HistorySession {
    return this.historyService.createSession();
  }

  /** 列出所有历史会话，按最近活跃时间倒序 */
  @Get('sessions')
  listSessions(@Query('limit') limitRaw?: string): HistorySession[] {
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 100;
    return this.historyService.listSessions(
      Number.isFinite(limit) && limit > 0 ? limit : 100,
    );
  }

  /** 读取指定会话的全部消息 */
  @Get('sessions/:id/messages')
  getSessionMessages(@Param('id') id: string): HistoryMessage[] {
    if (!this.historyService.hasSession(id)) {
      throw new HttpException('session not found', HttpStatus.NOT_FOUND);
    }
    return this.historyService.getMessages(id);
  }

  /**
   * 在指定会话内做 FTS5 全文检索（"知识库"按钮走的独立通道）。
   * GET /agent/sessions/:id/search?q=xxx&limit=20
   *
   * - 不走 LLM，不写入历史，仅返回带 <mark> 高亮片段的命中列表；
   * - 空 query / 无匹配 → 返回空数组，前端据此展示"未命中"。
   */
  @Get('sessions/:id/search')
  searchSessionMessages(
    @Param('id') id: string,
    @Query('q') query: string,
    @Query('limit') limitRaw?: string,
  ): HistorySearchHit[] {
    if (!this.historyService.hasSession(id)) {
      throw new HttpException('session not found', HttpStatus.NOT_FOUND);
    }
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 20;
    return this.historyService.searchMessages(
      id,
      query ?? '',
      Number.isFinite(limit) && limit > 0 ? limit : 20,
    );
  }

  /** 删除一个会话（连同其消息） */
  @Delete('sessions/:id')
  deleteSession(@Param('id') id: string): { ok: boolean } {
    const ok = this.historyService.deleteSession(id);
    if (!ok) {
      throw new HttpException('session not found', HttpStatus.NOT_FOUND);
    }
    return { ok };
  }
}

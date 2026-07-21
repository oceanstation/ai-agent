import { Controller, Query, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AgentService } from './agent.service';
import type { AgentInvokeResult } from './agent.types';
import { messagesToBlocks, type ContentBlock } from './agent.blocks';

@Controller('agent')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  /**
   * 流式调用 DeepAgent（SSE）—— Content Block 协议
   * GET /agent/invoke?message=...
   *
   * 每条 SSE data 都是一个 ContentBlock，对齐 OpenAI / Anthropic Messages API 风格：
   *   { type: 'text'     | 'list' | 'json' | 'tool_use' | 'done', ... }
   */
  @Sse('invoke')
  stream(@Query('message') message: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let cancelled = false;

      void (async () => {
        try {
          // 增量策略：memory 相关 tool_use 与 tool 结果需要跨消息才能识别归属，
          // 因此每个 chunk 到达时，先对**全量** messages 做过滤转换，得到当前
          // 应展示的 blocks 序列，再与已推数量 diff，只把新增部分推给前端。
          let emittedBlockCount = 0;

          const iterator: AsyncIterable<AgentInvokeResult> =
            this.agentService.stream(message);

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
}

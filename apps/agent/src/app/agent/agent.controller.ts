import { Body, Controller, Post, Query, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AgentService } from './agent.service';
import { InvokeAgentDto } from './dto/invoke-agent.dto';
import type { AgentInvokeResult } from './agent.types';
import { extractMessageText } from './agent.types';
import { messageToBlocks, type ContentBlock } from './agent.blocks';

@Controller('agent')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  /**
   * 调用 DeepAgent（一次性返回）
   * POST /agent/invoke
   * body: { "message": "..." }
   */
  @Post('invoke')
  async invoke(@Body() body: InvokeAgentDto) {
    const result = await this.agentService.invoke(body.message);
    const lastMessage = result.messages[result.messages.length - 1];
    const reply = lastMessage ? extractMessageText(lastMessage) : '';

    return {
      data: {
        reply,
        raw: result,
      },
    };
  }

  /**
   * 流式调用 DeepAgent（SSE）—— Content Block 协议
   * GET /agent/invoke/stream?message=...
   *
   * 每条 SSE data 都是一个 ContentBlock，对齐 OpenAI / Anthropic Messages API 风格：
   *   { type: 'text'     | 'list' | 'json' | 'tool_use' | 'done', ... }
   *
   * 之所以用 GET：SSE 的标准客户端 EventSource 只支持 GET。
   * 若需要复杂 body，可改用 fetch + ReadableStream 消费。
   */
  @Sse('invoke/stream')
  stream(@Query('message') message: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let cancelled = false;

      void (async () => {
        try {
          // 快照 diff：streamMode=values 每次返回完整 messages，
          // 这里只把「新增部分」转成 blocks 推给前端，避免重复。
          let emittedMessageCount = 0;

          const iterator: AsyncIterable<AgentInvokeResult> =
            this.agentService.stream(message);

          for await (const chunk of iterator) {
            if (cancelled) break;

            const newMessages = chunk.messages.slice(emittedMessageCount);
            emittedMessageCount = chunk.messages.length;

            for (const msg of newMessages) {
              const blocks: ContentBlock[] = messageToBlocks(msg);
              for (const block of blocks) {
                if (cancelled) break;
                subscriber.next({ data: block });
              }
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

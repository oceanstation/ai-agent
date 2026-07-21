import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { MemoryService } from '../memory/memory.service';

/**
 * write_memory 工具入参
 *
 * - scope=evergreen：写入 MEMORY.md，适合"用户以后要一直记住"的信息
 * - scope=daily：写入当日日志，适合本轮会话的过程性记忆
 */
const writeMemorySchema = z.object({
  scope: z
    .enum(['evergreen', 'daily'])
    .describe(
      '写入的记忆范围：evergreen=长期常青记忆（谨慎使用），daily=当日会话日志',
    ),
  content: z
    .string()
    .min(1)
    .describe('要写入的内容，建议使用简洁的 markdown bullet 列表'),
});

/**
 * 创建 write_memory 工具：允许 Agent 主动写入记忆。
 *
 * 使用约束（写在 description 里让模型自我约束）：
 * - 仅当用户明确表达"记住/以后..."或作出跨会话决策时才写 evergreen；
 * - 普通对话过程性总结应写 daily；
 * - 单条内容不宜过长，优先事实与偏好，避免主观修饰。
 */
export function createWriteMemoryTool(memory: MemoryService) {
  return tool(
    async ({ scope, content }: z.infer<typeof writeMemorySchema>) => {
      await memory.append(scope, content);
      return `已写入 ${scope === 'evergreen' ? 'MEMORY.md（常青）' : '当日日志'}。`;
    },
    {
      name: 'write_memory',
      description:
        '写入记忆：scope=evergreen 写入 MEMORY.md（跨会话持久，慎用），scope=daily 写入当日日志。仅在用户明确要求"记住"、或出现跨会话决策/偏好时使用；日常过程性信息写 daily。',
      schema: writeMemorySchema,
    },
  );
}

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { MemoryService } from '../memory/memory.service';

/**
 * read_memory 工具入参
 *
 * - scope=evergreen：读 MEMORY.md（忽略 date）
 * - scope=daily：读某一天的日志，date 缺省为今天
 */
const readMemorySchema = z.object({
  scope: z
    .enum(['evergreen', 'daily'])
    .describe('读取的记忆范围：evergreen=常青记忆，daily=每日日志'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('仅在 scope=daily 时生效，格式 YYYY-MM-DD，缺省为今天'),
});

/**
 * 创建 read_memory 工具：允许 Agent 主动查询已有记忆。
 *
 * 典型场景：用户问"我之前跟你说过我喜欢什么栈"，Agent 可通过本工具
 * 查询 MEMORY.md 或历史日志，避免瞎猜。
 */
export function createReadMemoryTool(memory: MemoryService) {
  return tool(
    async ({ scope, date }: z.infer<typeof readMemorySchema>) => {
      if (scope === 'evergreen') {
        const text = await memory.loadEvergreen();
        return text || '（MEMORY.md 为空或不存在）';
      }
      const d = date ? new Date(`${date}T00:00:00`) : new Date();
      const text = await memory.loadDaily(d);
      return text || `（${date ?? '今日'} 无日志）`;
    },
    {
      name: 'read_memory',
      description:
        '读取记忆：scope=evergreen 读常青记忆（MEMORY.md），scope=daily 读某天日志（date=YYYY-MM-DD，默认今天）。用于回忆用户偏好、历史决策等。',
      schema: readMemorySchema,
    },
  );
}

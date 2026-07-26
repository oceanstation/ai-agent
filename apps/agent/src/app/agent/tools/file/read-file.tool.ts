import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { WorkspaceService } from '../../workspace/workspace.service';
import { WorkspaceError } from '../../workspace/workspace.service';

/**
 * read_file 工具入参
 *
 * 路径语义：相对 workspace 根，使用 `/` 分隔；也允许绝对路径，但必须落在 workspace 内。
 * 出于上下文预算考虑，支持可选的 offset / limit 按行截取。
 */
const readFileSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe(
      '相对 workspace 根的文件路径（如 "src/index.ts"）。禁止使用 ../ 逃出 workspace。',
    ),
  offset: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('起始行号（1-based），省略则从第 1 行开始读'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(2000)
    .optional()
    .describe('最多读取多少行，省略则读完（受 workspace 文件大小上限约束）'),
});

/**
 * 创建 read_file 工具：读取 workspace 内的文本文件。
 */
export function createReadFileTool(workspace: WorkspaceService) {
  return tool(
    async ({ path: p, offset, limit }: z.infer<typeof readFileSchema>) => {
      try {
        const abs = await workspace.resolve(p, { mustExist: true });
        const content = await workspace.readTextFile(abs);

        // 无切片请求：直接返回全文
        if (offset == null && limit == null) return content;

        const lines = content.split('\n');
        const start = (offset ?? 1) - 1;
        const end = limit != null ? start + limit : lines.length;
        const sliced = lines.slice(start, end);
        const header = `# 显示 ${p} 的 ${start + 1}-${Math.min(end, lines.length)} 行（共 ${lines.length} 行）\n`;
        return header + sliced.join('\n');
      } catch (err) {
        return formatError(err, p);
      }
    },
    {
      name: 'read_file',
      description:
        '读取 workspace 内的文本文件。参数 path 必须相对 workspace 根，禁止使用 ../ 逃逸。可选 offset/limit 按行截取，读大文件时请务必设置。',
      schema: readFileSchema,
    },
  );
}

function formatError(err: unknown, p: string): string {
  if (err instanceof WorkspaceError) {
    return `read_file 失败 [${err.code}] ${err.message}`;
  }
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') return `read_file 失败：文件不存在（${p}）`;
  if (code === 'EISDIR') return `read_file 失败：目标是目录（${p}），请改用 list_dir`;
  return `read_file 失败：${(err as Error).message}`;
}

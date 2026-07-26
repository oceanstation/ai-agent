import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import * as fs from 'node:fs/promises';
import type { WorkspaceService } from '../../workspace/workspace.service';
import { WorkspaceError } from '../../workspace/workspace.service';

/**
 * write_file 工具入参
 *
 * mode:
 *   - overwrite（默认）：完全覆盖已有内容；文件不存在则创建
 *   - append：追加到文件末尾；文件不存在则创建
 *   - create：仅当文件不存在时创建，已存在则报错（防误覆盖）
 */
const writeFileSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe('相对 workspace 根的文件路径。父目录会自动创建。'),
  content: z.string().describe('要写入的完整文本内容'),
  mode: z
    .enum(['overwrite', 'append', 'create'])
    .default('overwrite')
    .describe(
      '写入模式：overwrite=覆盖(默认)；append=追加；create=仅创建，文件已存在时会失败',
    ),
});

/**
 * 创建 write_file 工具：向 workspace 写入文本文件。
 *
 * 前置条件：WORKSPACE_WRITABLE=true。否则调用会被 WorkspaceService.assertWritable 拒绝。
 */
export function createWriteFileTool(workspace: WorkspaceService) {
  return tool(
    async ({ path: p, content, mode }: z.infer<typeof writeFileSchema>) => {
      try {
        workspace.assertWritable();
        const abs = await workspace.resolve(p);

        if (mode === 'create') {
          // 借 O_EXCL 语义：文件已存在则失败；同时受 maxFileSize 约束
          const size = Buffer.byteLength(content, 'utf-8');
          const cfg = workspace.getConfig();
          if (size > cfg.maxFileSize) {
            return `write_file 失败：内容 ${size} 字节超过上限 ${cfg.maxFileSize}`;
          }
          const handle = await fs.open(abs, 'wx');
          try {
            await handle.writeFile(content, 'utf-8');
          } finally {
            await handle.close();
          }
          return `已创建文件：${p}（${size} 字节）`;
        }

        if (mode === 'append') {
          // 追加不做单次大小校验（可能已有巨大文件），但仍限单次写入片段大小
          const size = Buffer.byteLength(content, 'utf-8');
          const cfg = workspace.getConfig();
          if (size > cfg.maxFileSize) {
            return `write_file 失败：追加内容 ${size} 字节超过上限 ${cfg.maxFileSize}`;
          }
          await fs.appendFile(abs, content, 'utf-8');
          return `已追加到：${p}（+${size} 字节）`;
        }

        // overwrite（默认）
        await workspace.writeTextFile(abs, content);
        const size = Buffer.byteLength(content, 'utf-8');
        return `已写入：${p}（${size} 字节，overwrite）`;
      } catch (err) {
        return formatError(err, p);
      }
    },
    {
      name: 'write_file',
      description:
        '向 workspace 写入文本文件。仅在用户明确要求"新建/修改文件"时使用；默认 overwrite 会覆盖原内容，请谨慎。workspace 只读时会失败。',
      schema: writeFileSchema,
    },
  );
}

function formatError(err: unknown, p: string): string {
  if (err instanceof WorkspaceError) {
    return `write_file 失败 [${err.code}] ${err.message}`;
  }
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'EEXIST') return `write_file 失败：文件已存在（${p}），create 模式不覆盖`;
  if (code === 'EISDIR') return `write_file 失败：目标是目录（${p}）`;
  return `write_file 失败：${(err as Error).message}`;
}

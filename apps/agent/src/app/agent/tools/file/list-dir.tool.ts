import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { WorkspaceService } from '../../workspace/workspace.service';
import { WorkspaceError } from '../../workspace/workspace.service';

/**
 * list_dir 工具入参
 */
const listDirSchema = z.object({
  path: z
    .string()
    .default('.')
    .describe(
      '相对 workspace 根的目录路径，默认为 workspace 根（"."）。',
    ),
  showHidden: z
    .boolean()
    .default(false)
    .describe('是否展示以 "." 开头的隐藏文件，默认 false'),
});

/**
 * 创建 list_dir 工具：列出 workspace 内某目录的直接子项。
 *
 * 输出格式：每行 "d|f  <name>  [size|children=…]"，方便 LLM 直接阅读。
 */
export function createListDirTool(workspace: WorkspaceService) {
  return tool(
    async ({ path: p, showHidden }: z.infer<typeof listDirSchema>) => {
      try {
        const abs = await workspace.resolve(p, { mustExist: true });
        const stat = await fs.stat(abs);
        if (!stat.isDirectory()) {
          return `list_dir 失败：目标不是目录（${p}），请改用 read_file`;
        }

        const cfg = workspace.getConfig();
        const entries = await fs.readdir(abs, { withFileTypes: true });

        const filtered = entries.filter(
          (e) => showHidden || !e.name.startsWith('.'),
        );

        // 目录在前、文件在后，各自按名字排序，读起来更顺
        filtered.sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) {
            return a.isDirectory() ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });

        const total = filtered.length;
        const shown = filtered.slice(0, cfg.maxListEntries);

        const lines: string[] = [];
        for (const entry of shown) {
          const full = path.join(abs, entry.name);
          if (entry.isDirectory()) {
            lines.push(`d  ${entry.name}/`);
          } else if (entry.isSymbolicLink()) {
            lines.push(`l  ${entry.name}`);
          } else {
            try {
              const s = await fs.stat(full);
              lines.push(`f  ${entry.name}  ${s.size}B`);
            } catch {
              lines.push(`f  ${entry.name}`);
            }
          }
        }

        const header = `# 目录：${workspace.toRelative(abs)}（共 ${total} 项${
          total > shown.length ? `，仅显示前 ${shown.length}` : ''
        }）`;
        return [header, ...lines].join('\n');
      } catch (err) {
        return formatError(err, p);
      }
    },
    {
      name: 'list_dir',
      description:
        '列出 workspace 内某个目录的直接子项（不递归）。目录以 "/" 结尾，文件附带字节大小。默认隐藏以 "." 开头的文件。',
      schema: listDirSchema,
    },
  );
}

function formatError(err: unknown, p: string): string {
  if (err instanceof WorkspaceError) {
    return `list_dir 失败 [${err.code}] ${err.message}`;
  }
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') return `list_dir 失败：目录不存在（${p}）`;
  if (code === 'ENOTDIR') return `list_dir 失败：目标不是目录（${p}）`;
  return `list_dir 失败：${(err as Error).message}`;
}

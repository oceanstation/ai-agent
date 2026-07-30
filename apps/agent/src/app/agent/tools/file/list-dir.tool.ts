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
 * 输出为 markdown：一级标题标示路径与总数，随后以带图标的列表列出直接子项，
 * 文件带人类友好大小（B/KB/MB）；前端会走 MarkdownBlock 渲染。
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
            lines.push(`- 📁 \`${entry.name}/\``);
          } else if (entry.isSymbolicLink()) {
            lines.push(`- 🔗 \`${entry.name}\``);
          } else {
            try {
              const s = await fs.stat(full);
              lines.push(`- 📄 \`${entry.name}\` · ${formatSize(s.size)}`);
            } catch {
              lines.push(`- 📄 \`${entry.name}\``);
            }
          }
        }

        const rel = workspace.toRelative(abs);
        const truncated = total > shown.length ? `，仅显示前 ${shown.length}` : '';
        const header = `**📂 \`${rel}\`** · 共 ${total} 项${truncated}`;
        const body = lines.length ? lines.join('\n') : '_（空目录）_';
        return `${header}\n\n${body}`;
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

/** 把字节数转成人类友好的显示（B / KB / MB） */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
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

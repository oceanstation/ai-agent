import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { WorkspaceService } from '../workspace/workspace.service';
import { WorkspaceError } from '../workspace/workspace.service';

/**
 * run_command 工具入参
 *
 * 注意事项：
 *   - `command` 只接受可执行文件名（basename），且必须在 WORKSPACE_COMMAND_ALLOWLIST 中
 *   - `args` 以数组传入，不走 shell 解析，杜绝命令注入
 *   - `cwd` 可选，默认 workspace 根；若给出则必须在 workspace 内
 */
const runCommandSchema = z.object({
  command: z
    .string()
    .min(1)
    .describe(
      '要执行的可执行文件名，例如 "ls" / "node" / "git"。必须在 workspace 命令白名单中。',
    ),
  args: z
    .array(z.string())
    .default([])
    .describe('参数数组（不走 shell 解析），例如 ["status", "-s"]'),
  cwd: z
    .string()
    .optional()
    .describe('可选：相对 workspace 根的工作目录；省略则使用 workspace 根'),
});

/**
 * 创建 run_command 工具：在 workspace 内执行受限命令。
 *
 * 前置条件：WORKSPACE_COMMAND_ENABLED=true 且命令在 WORKSPACE_COMMAND_ALLOWLIST 中。
 * 结果包含 exit code、stdout、stderr，以及是否超时/截断的标志。
 */
export function createRunCommandTool(workspace: WorkspaceService) {
  return tool(
    async ({ command, args, cwd }: z.infer<typeof runCommandSchema>) => {
      try {
        const result = await workspace.runCommand(command, args, cwd);
        const cfg = workspace.getConfig();

        const parts: string[] = [];
        parts.push(`# ${command} ${args.join(' ')}`.trimEnd());
        parts.push(
          `exit=${result.code ?? 'null'}${result.timedOut ? ` (timeout ${cfg.commandTimeoutMs}ms)` : ''}${
            result.truncated ? ' (output truncated)' : ''
          }`,
        );
        if (result.stdout) {
          parts.push('## stdout');
          parts.push(result.stdout.trimEnd());
        }
        if (result.stderr) {
          parts.push('## stderr');
          parts.push(result.stderr.trimEnd());
        }
        return parts.join('\n');
      } catch (err) {
        if (err instanceof WorkspaceError) {
          return `run_command 失败 [${err.code}] ${err.message}`;
        }
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          return `run_command 失败：找不到可执行文件 "${command}"`;
        }
        return `run_command 失败：${(err as Error).message}`;
      }
    },
    {
      name: 'run_command',
      description:
        '在 workspace 内执行受限的本地命令，不走 shell 解析。仅支持 workspace 命令白名单中的可执行文件；args 以数组形式传入。返回 exit code、stdout、stderr（可能被截断）。',
      schema: runCommandSchema,
    },
  );
}

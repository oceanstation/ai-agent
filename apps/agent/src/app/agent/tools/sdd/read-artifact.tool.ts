import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { SddService } from '../../sdd/sdd.service';

const readArtifactSchema = z.object({
  featureId: z.string().min(1).describe('要读取的 feature 标识'),
  phase: z
    .enum(['specify', 'plan', 'tasks', 'implement'])
    .optional()
    .describe('可选阶段；不传则返回该 feature 所有已写阶段的产物'),
});

/**
 * sdd_read_artifact：读取某个 feature 的 SDD 产物。
 *
 * 用于下一阶段执行前把上一阶段结论拉回上下文（例如 plan 阶段先读 specify）。
 * 返回 JSON 字符串数组 `[{phase, path, content}]`；无产物时返回空数组。
 */
export function createReadArtifactTool(sdd: SddService) {
  return tool(
    async ({ featureId, phase }: z.infer<typeof readArtifactSchema>) => {
      try {
        const items = await sdd.readArtifact(featureId, phase);
        return JSON.stringify(items);
      } catch (err) {
        return `sdd_read_artifact 失败：${(err as Error).message}`;
      }
    },
    {
      name: 'sdd_read_artifact',
      description:
        '读取指定 feature 的 SDD 产物；不传 phase 返回全部已写阶段，用于在 plan/tasks/implement 阶段之前把 specify/plan 拉回上下文。',
      schema: readArtifactSchema,
    },
  );
}

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { SddService } from '../../sdd/sdd.service';
import type { SddGateSignal } from '../../sdd/sdd.types';

const writeArtifactSchema = z.object({
  featureId: z
    .string()
    .min(1)
    .describe(
      'feature 标识（小写字母/数字/-/_/.，长度 ≤ 64）；同一 feature 的四阶段共用',
    ),
  phase: z
    .enum(['specify', 'plan', 'tasks', 'implement'])
    .describe('SDD 阶段：specify → plan → tasks → implement'),
  content: z
    .string()
    .min(1)
    .describe(
      '完整 markdown 产物文本；同一阶段再次写入将覆盖之前内容并清空批准状态',
    ),
});

/**
 * sdd_write_artifact：写入某个 feature 某个阶段的规约产物。
 *
 * 关键行为：
 *   - 阶段闸门在 SddService 侧校验：进入 plan/tasks/implement 前一阶段必须已批准；
 *   - 成功时返回一段带 `__sddGate: true` 的 JSON，agent.blocks.ts 会把它识别为 spec_gate；
 *   - 失败时（闸门/参数/写盘）返回一段人类可读的错误字符串，模型据此自我纠正。
 */
export function createWriteArtifactTool(sdd: SddService) {
  return tool(
    async ({ featureId, phase, content }: z.infer<typeof writeArtifactSchema>) => {
      try {
        const { path, pendingApproval, timeline } = await sdd.writeArtifact(
          featureId,
          phase,
          content,
        );

        // 仅在"确需用户审批"或"implement 收尾展示"时下发阶段卡片。
        // 已批准阶段的过程性回写（典型：implement 勾选 tasks.md 清单）不再刷卡，
        // 否则每完成一项都会在对话流里多冒出一张 spec_gate 卡片，观感像重复弹窗。
        const shouldEmitGate = pendingApproval || phase === 'implement';
        if (!shouldEmitGate) {
          return `已更新 ${path}（${phase} 阶段清单，属过程性回写，无需重新审批）`;
        }

        const signal: SddGateSignal = {
          __sddGate: true,
          featureId,
          phase,
          path,
          pendingApproval,
          timeline,
        };
        return JSON.stringify(signal);
      } catch (err) {
        return `sdd_write_artifact 失败：${(err as Error).message}`;
      }
    },
    {
      name: 'sdd_write_artifact',
      description:
        '规约驱动开发（SDD）产物写入。用于把 specify/plan/tasks/implement 四阶段的 markdown 落盘到 .specify/<featureId>/<phase>.md，并推进阶段状态机。进入下一阶段前必须先获得用户批准，否则会被拒绝。',
      schema: writeArtifactSchema,
    },
  );
}

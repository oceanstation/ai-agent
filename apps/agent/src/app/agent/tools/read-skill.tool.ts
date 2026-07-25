import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { SkillService } from '../skills/skill.service';

/**
 * read_skill 工具入参
 */
const readSkillSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      '要加载的 skill 名称，必须来自 system prompt 中列出的可用 skill 列表',
    ),
});

/**
 * 创建 read_skill 工具：让 Agent 在需要时按名字加载 SKILL.md 全文。
 * 返回：
 *   - 成功：SKILL.md 原文（含 frontmatter）
 *   - skill 不存在：一段可读错误 + 当前可用 skill 列表，帮助模型自我纠正
 */
export function createReadSkillTool(skills: SkillService) {
  return tool(
    async ({ name }: z.infer<typeof readSkillSchema>) => {
      const content = await skills.read(name);
      if (content == null) {
        const available = skills.listNames();
        return (
          `未找到名为 "${name}" 的 skill。` +
          (available.length
            ? `当前可用：${available.join(', ')}`
            : '当前没有已注册的 skill。')
        );
      }
      return content;
    },
    {
      name: 'read_skill',
      description:
        '按名字加载指定 skill 的 SKILL.md 全文（含使用方法与示例）。仅在 system prompt 中列出的 skill 有效；请先根据描述匹配再调用，不要凭空猜测 name。',
      schema: readSkillSchema,
    },
  );
}

import type { ConfigService } from '@nestjs/config';
import { resolveAgentPath } from '../../paths';

/**
 * Skill 子系统运行时配置。
 *
 * 目录结构约定（对齐 Anthropic Skills 规范）：
 *   <root>/<skill-name>/SKILL.md    —— 必须存在，含 YAML frontmatter
 *   <root>/<skill-name>/scripts/... —— 可选辅助脚本/资源
 */
export interface SkillConfig {
  /** skills 根目录（绝对路径） */
  root: string;
}

/**
 * 从 ConfigService 读取并归一化 Skill 配置。
 *
 * 独立函数便于测试时直接构造，无需启动 Nest 容器。
 *
 * 路径解析优先级（见 apps/agent/src/app/paths.ts）：
 *   1. 显式 `SKILLS_ROOT`；
 *   2. `AGENT_DATA_DIR/.skills`；
 *   3. 兼容旧默认：`apps/agent/.skills`。
 */
export function loadSkillConfig(configService: ConfigService): SkillConfig {
  const root = resolveAgentPath(
    configService.get<string>('SKILLS_ROOT'),
    '.skills',
    'apps/agent/.skills',
  );
  return { root };
}

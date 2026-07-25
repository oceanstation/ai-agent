import type { ConfigService } from '@nestjs/config';
import * as path from 'node:path';

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

const DEFAULT_ROOT = 'skills';

/**
 * 从 ConfigService 读取并归一化 Skill 配置。
 *
 * 独立函数便于测试时直接构造，无需启动 Nest 容器。
 */
export function loadSkillConfig(configService: ConfigService): SkillConfig {
  const raw = configService.get<string>('SKILLS_ROOT') ?? DEFAULT_ROOT;
  const root = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  return { root };
}

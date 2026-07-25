/**
 * Skill 元数据（Progressive Disclosure 的"卡片信息"）
 *
 * 只包含 SKILL.md frontmatter 中的必要字段，用于：
 *   1) 在 system prompt 中一次性列出所有可用 skill 的 name+description
 *      让模型知道"有哪些技能可用"但先不加载正文；
 *   2) 模型判断需要时，再通过 read_skill 工具按 name 获取 SKILL.md 全文。
 *
 * name 会作为工具入参的 enum 值，请保持文件夹名与 frontmatter.name 一致（推荐 kebab-case）。
 */
export interface SkillMeta {
  /** skill 名称，等同于目录名（kebab-case） */
  name: string;
  /** 一句话描述：什么时候用、能做什么 */
  description: string;
  /** SKILL.md 绝对路径，供 read_skill 工具读取 */
  filePath: string;
  /** skill 所在目录绝对路径，供正文中引用 scripts/ references/ 时定位 */
  dir: string;
}

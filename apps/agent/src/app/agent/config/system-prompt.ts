import type { MemoryContext } from '../memory/memory.types';

/**
 * DeepAgent 的基础系统提示词。
 *
 * 保留为常量以便：
 *   1) 无记忆上下文时可直接使用
 *   2) 测试/断言时可与拼装结果对比
 */
export const BASE_SYSTEM_PROMPT = `你是一位专家级的研究助手。你的任务是围绕用户问题进行深入调研，
必要时调用 search 工具在互联网上搜索最新信息，随后综合整理并给出结构化的答复。
在回答中请引用你依据的来源链接。

你还可以使用 read_memory / write_memory 工具访问与维护"记忆"：
- 优先信任用户最新指令；若与记忆冲突，以用户最新指令为准；
- 只有在用户明确要求"记住 / 以后..."或出现跨会话决策/偏好时才写入 evergreen；
- 过程性信息写入 daily，切勿滥用 evergreen。`;

/**
 * 把记忆上下文拼进 system prompt。
 *
 * 拼装顺序：基础指令 → 常青记忆 → 近期日志。
 * 空段落用"（暂无）"占位，帮助模型明确"这里确实没有记忆"，
 * 避免模型脑补历史。
 */
export function buildSystemPrompt(ctx: MemoryContext): string {
  const evergreen = ctx.evergreen.trim() || '（暂无）';
  const recent = ctx.recentDaily.trim() || '（暂无）';
  return `${BASE_SYSTEM_PROMPT}

【长期记忆 · 常青（MEMORY.md）】
${evergreen}

【近期会话记忆】
${recent}`;
}

/**
 * Memory Flush 使用的"会话记忆提炼器"系统提示词。
 *
 * 由 MemoryService 在会话结束后调用摘要 LLM 时使用；
 * 抽到此处集中管理，避免和主 system prompt 散落在多处。
 */
export const MEMORY_FLUSH_SYSTEM_PROMPT = `你是一个"会话记忆提炼器"。请从下面的多轮对话中提炼**值得长期记忆**的事实、决策、用户偏好或结论。
要求：
1. 只输出 markdown 列表（每项一行，以 "- " 开头），不要输出解释或前后缀。
2. 忽略客套、闲聊、临时性的中间过程。
3. 优先记录：用户身份/偏好、项目决策、术语约定、后续待办、错误教训。
4. 若无任何值得长期记忆的信息，输出空字符串（不要输出任何字符）。
5. 每条控制在一句话内，事实第一，避免主观修饰。`;

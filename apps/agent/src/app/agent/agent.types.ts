import type { BaseMessage } from '@langchain/core/messages';

/**
 * DeepAgent invoke 后返回的 state 结构（精简版）
 *
 * LangGraph 的 state 里还有 files / todos 等 DeepAgent 中间件字段，
 * 目前场景只关心 messages，其余用 unknown 兜底避免类型 any 化。
 */
export interface AgentInvokeResult {
  messages: BaseMessage[];
  files?: Record<string, string>;
  todos?: unknown[];
}

/**
 * 从一条 BaseMessage 中提取纯文本内容。
 *
 * BaseMessage.content 可能是 string 或 ContentBlock[]（多模态/工具场景），
 * LangChain 已在 BaseMessage 上暴露 `text` getter 处理好归一化，直接使用即可。
 */
export function extractMessageText(message: BaseMessage): string {
  return message.text;
}

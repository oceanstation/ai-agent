import type { BaseMessage } from '@langchain/core/messages';

/**
 * Agent invoke 后返回的 state 结构（精简版）
 *
 * 当前场景只关心 messages，LangGraph state 中其他字段如有需要再按需扩展。
 */
export interface AgentInvokeResult {
  messages: BaseMessage[];
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

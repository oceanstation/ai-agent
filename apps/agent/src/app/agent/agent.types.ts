import type { BaseMessage } from '@langchain/core/messages';
import { toFiniteNumber } from './utils/number';

/**
 * 单次 LLM 调用的 token 用量（LangChain 标准化字段 usage_metadata）。
 *
 * 一次 agent 交互可能触发多轮 LLM 调用（工具调用来回），
 * 我们会把所有 AIMessage 的用量累加起来，作为"本轮总消耗"。
 */
export interface TokenUsage {
  /** 输入 token 累计 */
  inputTokens: number;
  /** 输出 token 累计 */
  outputTokens: number;
  /** 总 token（= input + output） */
  totalTokens: number;
  /** 本轮参与统计的 LLM 调用次数（即 AIMessage 数量） */
  llmCalls: number;
  /** 本轮实际使用的模型名，由调用方在收尾时挂载 */
  model?: string;
}

/**
 * Agent invoke 后返回的 state 结构（精简版）
 *
 * 当前场景只关心 messages，LangGraph state 中其他字段如有需要再按需扩展。
 * usage 仅在 stream 收尾时挂载最后一份快照，便于上层日志/前端展示。
 */
export interface AgentInvokeResult {
  messages: BaseMessage[];
  usage?: TokenUsage;
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

/**
 * 汇总一批消息中的 token 用量。
 *
 * 只有走了真实 LLM 调用的消息才带该字段；工具消息 / 用户消息不会带。
 * 缺失时按 0 处理，永远不抛异常。
 */
export function sumTokenUsage(messages: BaseMessage[]): TokenUsage {
  const acc: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    llmCalls: 0,
  };
  for (const msg of messages) {
    const meta = (msg as unknown as { usage_metadata?: Record<string, unknown> })
      .usage_metadata;
    if (!meta) continue;
    const input = toFiniteNumber(meta['input_tokens']);
    const output = toFiniteNumber(meta['output_tokens']);
    const total = toFiniteNumber(meta['total_tokens']) || input + output;
    acc.inputTokens += input;
    acc.outputTokens += output;
    acc.totalTokens += total;
    acc.llmCalls += 1;
  }
  return acc;
}

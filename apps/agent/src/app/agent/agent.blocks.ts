import type { BaseMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import type { ContentBlock, ListBlock, ListItem } from '@ai-agent/common';
import { extractMessageText } from './agent.types';

// 本文件只保留后端专属的、依赖 LangChain 的转换逻辑。
export type { ContentBlock } from '@ai-agent/common';

/** 内部使用：AIMessage 上的 tool_calls 结构（LangChain 已归一化） */
interface AIToolCall {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
}

/**
 * 把一条 LangChain BaseMessage 转成 0~N 个 ContentBlock。
 *
 * - AIMessage：若含 tool_calls，先输出若干 tool_use；若含文本，追加一个 text。
 * - ToolMessage：优先识别 Tavily 结果转成 list，否则回落到 json。
 * - HumanMessage / SystemMessage 等：忽略（前端已展示或无需展示）。
 */
export function messageToBlocks(message: BaseMessage): ContentBlock[] {
  const type = (message as { getType?: () => string }).getType?.() ?? '';
  const blocks: ContentBlock[] = [];

  if (type === 'ai') {
    const ai = message as AIMessage;
    const toolCalls = (ai.tool_calls ?? []) as AIToolCall[];
    for (const call of toolCalls) {
      blocks.push({
        type: 'tool_use',
        id: call.id,
        name: call.name,
        input: call.args,
      });
    }
    const text = extractMessageText(ai).trim();
    if (text) blocks.push({ type: 'text', text });
    return blocks;
  }

  if (type === 'tool') {
    const tm = message as ToolMessage;
    const raw = parseToolContent(tm.content);
    const listBlock = tryAsList(raw);
    if (listBlock) return [listBlock];
    if (raw && typeof raw === 'object') {
      return [{ type: 'json', data: raw as Record<string, unknown> }];
    }
    // 纯字符串工具结果 → 文本
    const text = extractMessageText(tm).trim();
    if (text) return [{ type: 'text', text }];
    return [];
  }

  return [];
}

/** ToolMessage.content 可能是字符串（多数情况）或已解析对象，这里做一次归一化 */
function parseToolContent(content: unknown): unknown {
  if (typeof content !== 'string') return content;
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

/**
 * 尝试把工具结果解释为 list（当前主要匹配 Tavily 的 `{ results: [{title,url,...}] }`）。
 * 命中则返回 ListBlock，否则返回 null。
 */
function tryAsList(raw: unknown): ListBlock | null {
  if (!raw || typeof raw !== 'object') return null;
  const results = (raw as { results?: unknown }).results;
  if (!Array.isArray(results)) return null;

  const items: ListItem[] = [];
  for (const r of results) {
    if (r && typeof r === 'object') {
      const rec = r as Record<string, unknown>;
      const title = typeof rec.title === 'string' ? rec.title : '';
      const url = typeof rec.url === 'string' ? rec.url : '';
      if (title && url) items.push({ title, url });
    }
  }
  return items.length ? { type: 'list', items } : null;
}

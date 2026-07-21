import type { BaseMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import type { ContentBlock, ListBlock, ListItem } from '@ai-agent/common';
import { extractMessageText } from './agent.types';

// 本文件只保留后端专属的、依赖 LangChain 的转换逻辑。
export type { ContentBlock } from '@ai-agent/common';

/**
 * 不希望暴露到前端的工具名单。
 *
 * 记忆读写属于 Agent 的"内部脑内活动"，用户没必要看到，
 * 因此其 `tool_use` 调用块与对应 `tool` 返回块都会在转换阶段被过滤。
 * 注意：这里只影响"展示给用户"的通道，LLM 上下文中仍完整保留，
 * 不影响后续推理与 Memory Flush。
 */
export const HIDDEN_TOOL_NAMES: ReadonlySet<string> = new Set([
  'read_memory',
  'write_memory',
]);

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
 *
 * 注意：此函数是"单条消息"级别的转换，无法感知 ToolMessage 归属于哪个工具。
 * 需要按工具名过滤时，请使用 {@link messagesToBlocks}。
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

/**
 * 批量把消息序列转成 ContentBlock，并过滤掉 {@link HIDDEN_TOOL_NAMES} 中的工具痕迹。
 *
 * 之所以要"批量"：一条 ToolMessage 只带 `tool_call_id`，不带工具名，
 * 需要先扫描前面的 AIMessage.tool_calls 建立 id→name 映射，才能判断该丢弃哪些 tool 结果。
 *
 * 使用姿势：控制器/流式消费方在拿到 messages 数组后统一调用此函数，得到"面向用户的" blocks。
 */
export function messagesToBlocks(messages: BaseMessage[]): ContentBlock[] {
  const hiddenCallIds = collectHiddenToolCallIds(messages);
  const out: ContentBlock[] = [];

  for (const msg of messages) {
    const type = (msg as { getType?: () => string }).getType?.() ?? '';

    if (type === 'ai') {
      const ai = msg as AIMessage;
      const toolCalls = (ai.tool_calls ?? []) as AIToolCall[];
      for (const call of toolCalls) {
        if (call.name && HIDDEN_TOOL_NAMES.has(call.name)) continue;
        out.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: call.args,
        });
      }
      const text = extractMessageText(ai).trim();
      if (text) out.push({ type: 'text', text });
      continue;
    }

    if (type === 'tool') {
      const tm = msg as ToolMessage;
      if (tm.tool_call_id && hiddenCallIds.has(tm.tool_call_id)) continue;
      // 复用单条转换逻辑，保持行为一致
      out.push(...messageToBlocks(tm));
      continue;
    }
  }

  return out;
}

/** 扫描 AIMessage.tool_calls，收集 HIDDEN_TOOL_NAMES 命中的调用 ID */
function collectHiddenToolCallIds(messages: BaseMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const msg of messages) {
    const type = (msg as { getType?: () => string }).getType?.() ?? '';
    if (type !== 'ai') continue;
    const toolCalls = ((msg as AIMessage).tool_calls ?? []) as AIToolCall[];
    for (const call of toolCalls) {
      if (call.id && call.name && HIDDEN_TOOL_NAMES.has(call.name)) {
        ids.add(call.id);
      }
    }
  }
  return ids;
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

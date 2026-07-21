/**
 * Content Block —— 对齐 OpenAI / Anthropic Messages API 风格。
 *
 * 前后端共享的消息内容单元协议：
 *   - 后端每次 SSE 推送一个 ContentBlock
 *   - 前端按 `type` 字段分发到对应渲染组件
 *
 * 新增内容类型时，请在此文件扩展 ContentBlock 联合类型，
 * 前后端同时消费该定义，天然保证契约一致。
 */

/** 纯文本 / Markdown 内容 */
export interface TextBlock {
  type: 'text';
  text: string;
}

/** 列表条目（如搜索结果） */
export interface ListItem {
  title: string;
  url: string;
}

/** 列表内容（如搜索结果列表） */
export interface ListBlock {
  type: 'list';
  items: ListItem[];
}

/** 通用结构化 JSON 内容 */
export interface JsonBlock {
  type: 'json';
  data: Record<string, unknown>;
}

/** Agent 调用工具的意图 */
export interface ToolUseBlock {
  type: 'tool_use';
  id?: string;
  name: string;
  input?: Record<string, unknown>;
}

/** 流结束标记 */
export interface DoneBlock {
  type: 'done';
}

/** 所有 ContentBlock 变体的联合类型，前后端共同消费 */
export type ContentBlock =
  | TextBlock
  | ListBlock
  | JsonBlock
  | ToolUseBlock
  | DoneBlock;

/** ContentBlock 的所有可能 `type` 字面量 */
export type ContentBlockType = ContentBlock['type'];

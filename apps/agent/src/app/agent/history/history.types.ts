/**
 * History 子系统的公共类型定义。
 *
 * 与 Memory 的差异：
 * - Memory 存储的是 LLM 摘要（浓缩后的常青/日志记忆），供 system prompt 复用；
 * - History 存储的是**原始完整对话**（用户 + assistant + tool 结果），
 *   面向 UI 层的"历史会话列表 / 会话回放"能力。
 */

/** 一条对话消息在 History 视角下的最小结构 */
export interface HistoryMessage {
  /** 数据库自增 id；写入时可省略 */
  id?: number;
  /** 所属会话 ID */
  sessionId: string;
  /** 消息角色 */
  role: 'user' | 'assistant' | 'tool' | 'system';
  /** 归一化后的纯文本内容 */
  content: string;
  /** 若是 tool 调用或 tool 结果，记录工具名，便于回放时高亮 */
  toolName?: string | null;
  /** 保留原始 block json 字符串，便于后续按块回放；无则为 null */
  raw?: string | null;
  /** 写入时间（unix ms） */
  createdAt: number;
}

/** 会话（一次连续对话的容器） */
export interface HistorySession {
  /** 会话 ID（uuid） */
  id: string;
  /** 首条用户消息截断得到的标题；可为空 */
  title: string;
  /** 创建时间（unix ms） */
  createdAt: number;
  /** 最近一次追加消息的时间（unix ms） */
  updatedAt: number;
}

/** 追加消息时的入参（不含 id / createdAt，由 service 补齐） */
export interface AppendMessageInput {
  sessionId: string;
  role: HistoryMessage['role'];
  content: string;
  toolName?: string | null;
  raw?: string | null;
}

/**
 * FTS5 全文检索命中结果：在 HistoryMessage 基础上追加 `snippet` 字段，
 * 服务端已用 <mark></mark> 包裹关键词命中位置，前端可直接以 HTML 渲染。
 */
export interface HistorySearchHit extends HistoryMessage {
  /** 带高亮标签的摘要片段，例如 "……前文<mark>关键词</mark>后文……" */
  snippet: string;
}

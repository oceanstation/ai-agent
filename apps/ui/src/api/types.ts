/**
 * 后端接口的数据契约（DTO）。
 * 这里的类型是「前端与后端约定的传输结构」，与后端
 * apps/agent/.../history.types.ts 保持对齐；视图层的展示模型不在此处。
 */

/** 会话摘要：会话列表 / 新建会话接口的返回单元 */
export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

/** 历史消息：GET /sessions/:id/messages 的返回单元 */
export interface HistoryMessageDTO {
  id?: number;
  sessionId: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolName?: string | null;
  raw?: string | null;
  createdAt: number;
}

/** FTS5 命中：GET /sessions/:id/search 的返回单元 */
export interface HistorySearchHitDTO {
  id?: number;
  sessionId: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolName?: string | null;
  createdAt: number;
  snippet: string; // 已在服务端拼好 <mark> 高亮的片段
}

/** SDD 阶段产物：GET /sdd/artifact 的返回结构 */
export interface SddArtifact {
  content: string;
}

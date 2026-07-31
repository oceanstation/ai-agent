/** 会话相关接口：历史消息、列表、CRUD、知识库检索。 */
import { del, get, post } from './http';
import type {
  HistoryMessageDTO,
  HistorySearchHitDTO,
  SessionSummary,
} from './types';

/** 拉取某会话的历史消息（session 不存在时后端返回 404 → ApiError.status=404） */
export function fetchSessionMessages(
  sessionId: string,
): Promise<HistoryMessageDTO[]> {
  return get<HistoryMessageDTO[]>(
    `/sessions/${encodeURIComponent(sessionId)}/messages`,
  );
}

/** 拉取会话列表 */
export function fetchSessions(): Promise<SessionSummary[]> {
  return get<SessionSummary[]>('/sessions');
}

/** 新建会话，返回其摘要 */
export function createSession(): Promise<SessionSummary> {
  return post<SessionSummary>('/sessions');
}

/** 删除会话 */
export function deleteSession(sessionId: string): Promise<void> {
  return del(`/sessions/${encodeURIComponent(sessionId)}`);
}

/** 知识库（FTS5）检索：返回命中片段（含服务端拼好的 <mark> 高亮） */
export function searchSession(
  sessionId: string,
  query: string,
): Promise<HistorySearchHitDTO[]> {
  return get<HistorySearchHitDTO[]>(
    `/sessions/${encodeURIComponent(sessionId)}/search`,
    { q: query },
  );
}

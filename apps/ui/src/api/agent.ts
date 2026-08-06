/** Agent 调用：/agent/invoke 的 SSE 流式通道。 */
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { AGENT_BASE } from './http';

export interface InvokeAgentParams {
  /** 用户输入 / 系统触发的提示词 */
  message: string;
  /** 已有会话 id；首次对话为空，后端会新建并于首帧下发 session block */
  sessionId?: string | null;
  /** 收到一帧非空数据（原始字符串，通常是 JSON 的 ContentBlock），由调用方解析路由 */
  onMessage: (data: string) => void;
  /** 流错误回调 */
  onError?: (error: unknown) => void;
}

/**
 * 发起一次 /agent/invoke SSE 调用。
 * 只负责传输：拼 query、消费事件流、透传非空数据；
 * 帧的解析与渲染路由留给调用方（见 ChatView）。
 */
export function invokeAgent({
  message,
  sessionId,
  onMessage,
  onError,
}: InvokeAgentParams): Promise<void> {
  const params = new URLSearchParams({ message });
  if (sessionId) params.set('sessionId', sessionId);

  return fetchEventSource(`${AGENT_BASE}/invoke?${params.toString()}`, {
    onmessage(event) {
      if (event.data) onMessage(event.data);
    },
    onerror(error) {
      onError?.(error);
    },
  });
}

export interface ResumeAgentParams {
  /** 后端 run 标识（首帧 `run` 下发） */
  runId: string;
  /** 已消费的 block 序号（不含 session/run 元帧）；从此位置续订 */
  cursor: number;
  /** 收到一帧非空数据（同 invokeAgent） */
  onMessage: (data: string) => void;
  /** 流错误回调；404（run 已过期）通常由此路径抛出 */
  onError?: (error: unknown) => void;
}

/**
 * 续订一个已经启动的 run：/agent/runs/:runId/stream?cursor=n
 *
 * 页面刷新场景下使用：前端从 localStorage 拿到 (runId, cursor)，
 * 通过本函数拉取"已经错过的 blocks + 未来增量"，实现无缝重连。
 *
 * 若后端 run 已过期（超过保留 TTL / 服务重启），会返回 404；
 * 调用方应在 onError 中处理并回退到读取会话历史。
 */
export function resumeAgent({
  runId,
  cursor,
  onMessage,
  onError,
}: ResumeAgentParams): Promise<void> {
  const params = new URLSearchParams({ cursor: String(cursor) });
  return fetchEventSource(
    `${AGENT_BASE}/runs/${encodeURIComponent(runId)}/stream?${params.toString()}`,
    {
      onmessage(event) {
        if (event.data) onMessage(event.data);
      },
      onerror(error) {
        onError?.(error);
        // 抛出以便调用方 catch 得到；否则 fetch-event-source 会自动重连
        throw error;
      },
    },
  );
}

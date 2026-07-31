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

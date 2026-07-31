import { ref } from 'vue';
import type { ContentBlock } from '@ai-agent/common';
import * as api from '@/api';

import { generateId } from '@/utils/id';

/**
 * 前端 ChatMessage：视图层唯一持有的消息单元。
 * 每条消息就是"角色 + 一个 ContentBlock"，渲染时按 block.type 分发组件。
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  block: ContentBlock;
}

const SESSION_STORAGE_KEY = 'ai-agent:sessionId';

/** 判定「普通对象」——排除 null 与数组，避免 `typeof === 'object'` 的经典陷阱 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 从任意对象里安全提取一个字符串字段；类型不匹配时回退为空串 */
function pickString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === 'string' ? v : '';
}

/** 静默地把 sessionId 写入 localStorage（隐私模式下抛错就吞掉） */
function safeSetSessionId(id: string | null) {
  try {
    if (id === null) localStorage.removeItem(SESSION_STORAGE_KEY);
    else localStorage.setItem(SESSION_STORAGE_KEY, id);
  } catch {
    // 隐私模式下 localStorage 可能不可用，忽略即可
  }
}

/**
 * 把后端持久化的 HistoryMessage 还原为前端 ChatMessage。
 * 用户/助手直接映射为 text；tool 消息尽量结构化（Tavily 结果 → list；其余 → json）。
 */
function historyToChatMessage(msg: api.HistoryMessageDTO): ChatMessage | null {
  if (msg.role === 'system') return null;
  if (!msg.content?.trim()) return null;

  if (msg.role === 'user') {
    return {
      id: generateId(),
      role: 'user',
      block: { type: 'text', text: msg.content },
    };
  }

  if (msg.role === 'assistant') {
    return {
      id: generateId(),
      role: 'assistant',
      block: { type: 'text', text: msg.content },
    };
  }

  // tool：尝试还原为更结构化的展示
  let parsed: unknown = msg.content;
  try {
    parsed = JSON.parse(msg.content);
  } catch {
    // 保持原字符串
  }

  // 只有「普通对象」才值得进一步结构化解析（数组也一并纳入，走 json 展示）
  if (isRecord(parsed)) {
    // 1) Tavily 风格：{ results: [{ title, url }, ...] } → list block
    const results = parsed.results;
    if (Array.isArray(results)) {
      const items = results
        .filter(isRecord)
        .map((r) => ({ title: pickString(r, 'title'), url: pickString(r, 'url') }))
        .filter((it) => it.title && it.url);

      if (items.length) {
        return {
          id: generateId(),
          role: 'assistant',
          block: { type: 'list', items, source: 'tool' },
        };
      }
    }

    // 2) 其它对象结构 → json block（直接透传，交给 JsonBlock 组件渲染）
    return {
      id: generateId(),
      role: 'assistant',
      block: { type: 'json', data: parsed, source: 'tool' },
    };
  }

  // 数组根节点：也走 json 展示
  if (Array.isArray(parsed)) {
    return {
      id: generateId(),
      role: 'assistant',
      block: { type: 'json', data: parsed as unknown[], source: 'tool' },
    };
  }

  return {
    id: generateId(),
    role: 'assistant',
    block: { type: 'text', text: msg.content, source: 'tool' },
  };
}

/**
 * useChatSession —— 会话与消息状态的单一入口。
 *
 * 负责：sessionId 的持久化 / 消息数组 / 会话列表 / 会话 CRUD / 历史回放；
 * 不负责：SSE 流的消费、输入框状态、DOM 滚动 —— 这些留在 ChatView 里。
 */
export function useChatSession() {
  const sessionId = ref<string | null>(
    localStorage.getItem(SESSION_STORAGE_KEY),
  );
  const messages = ref<ChatMessage[]>([]);
  const sessionList = ref<api.SessionSummary[]>([]);
  const sessionsLoading = ref(false);

  /** 幂等地覆写 sessionId，同步写回 localStorage */
  const persistSessionId = (id: string) => {
    if (sessionId.value === id) return;
    sessionId.value = id;
    safeSetSessionId(id);
  };

  /** 清空 sessionId（本地存储 + 内存），供"删除当前会话"等场景使用 */
  const clearSessionId = () => {
    sessionId.value = null;
    safeSetSessionId(null);
  };

  /**
   * 页面挂载时，若本地已存有 sessionId 则拉取历史消息并回放。
   * - 后端 404（session 已被清理）→ 清空 localStorage，等下一轮对话新建。
   * - 网络异常 → 静默降级，不影响首次发送。
   */
  const restoreHistory = async () => {
    const id = sessionId.value;
    if (!id) return;

    try {
      const rows = await api.fetchSessionMessages(id);
      const restored = rows
        .map(historyToChatMessage)
        .filter((m): m is ChatMessage => m !== null);
      if (restored.length) messages.value = restored;
    } catch (err) {
      // 404（session 已被清理）→ 清空本地 id，等下一轮对话新建；
      // 其余 HTTP 错误静默降级，仅网络/解析异常告警。
      if (err instanceof api.ApiError) {
        if (err.status === 404) clearSessionId();
        return;
      }
      console.warn('恢复历史消息失败:', err);
    }
  };

  /** 拉取会话列表，失败时静默降级（不阻断主流程） */
  const fetchSessions = async () => {
    sessionsLoading.value = true;
    try {
      sessionList.value = await api.fetchSessions();
    } catch (err) {
      console.warn('拉取会话列表失败:', err);
    } finally {
      sessionsLoading.value = false;
    }
  };

  /** 切换到指定会话：写回 sessionId + 清空当前消息 + 回放历史 */
  const selectSession = async (id: string) => {
    if (id === sessionId.value) return;
    persistSessionId(id);
    messages.value = [];
    await restoreHistory();
  };

  /** 新建会话：拿到 id 后置顶列表并切换 */
  const createSession = async () => {
    try {
      sessionsLoading.value = true;
      const created = await api.createSession();
      sessionList.value = [created, ...sessionList.value];
      persistSessionId(created.id);
      messages.value = [];
    } catch (err) {
      console.warn('新建会话失败:', err);
    } finally {
      sessionsLoading.value = false;
    }
  };

  /** 删除会话：后端成功后重新拉取列表*/
  const deleteSession = async (id: string) => {
    if (!window.confirm('确定删除该会话？删除后无法恢复。')) return;

    try {
      await api.deleteSession(id);

      const current = id === sessionId.value;
      if (current) {
        clearSessionId();
        messages.value = [];
      }
      await fetchSessions();
      if (current && sessionList.value.length > 0) {
        await selectSession(sessionList.value[0].id);
      }
    } catch (err) {
      console.warn('删除会话失败:', err);
    }
  };

  /** 追加一条用户消息（统一走 text block） */
  const appendUserMessage = (text: string) => {
    messages.value.push({
      id: generateId(),
      role: 'user',
      block: { type: 'text', text },
    });
  };

  /**
   * 追加一条 assistant block；控制型 block（done / session）不入消息流。
   * session block 由调用方另行处理（通常用来 persistSessionId）。
   */
  const appendAssistantBlock = (block: ContentBlock) => {
    if (block.type === 'done' || block.type === 'session') return;
    messages.value.push({ id: generateId(), role: 'assistant', block });
  };

  return {
    // 状态
    sessionId,
    messages,
    sessionList,
    sessionsLoading,
    // 会话 CRUD
    restoreHistory,
    fetchSessions,
    selectSession,
    createSession,
    deleteSession,
    // 消息追加
    persistSessionId,
    appendUserMessage,
    appendAssistantBlock,
  };
}

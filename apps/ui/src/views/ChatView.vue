<template>
  <div class="chat-layout">
    <SessionPanel
      :sessions="sessionList"
      :current-id="sessionId"
      :collapsed="panelCollapsed"
      :loading="sessionsLoading"
      @toggle="panelCollapsed = !panelCollapsed"
      @select="handleSelectSession"
      @create="handleCreateSession"
      @delete="handleDeleteSession"
    />

    <div class="chat-container">
      <div ref="messageContainer" class="chat-messages">
        <div
          v-for="(message, index) in messages"
          :key="index"
          :class="['message', message.role]"
        >
          <component
            :is="RENDERER_MAP[message.block.type]"
            v-bind="rendererProps(message.block)"
            :class="wrapperClass(message.block.type)"
          />
        </div>
        <div v-if="isLoading" class="message assistant">
          <LoadingDots />
        </div>
      </div>

      <div class="chat-input">
        <div class="input-wrapper">
          <textarea
            v-model="userInput"
            :placeholder="
              useKnowledgeBase
                ? '输入关键词（至少 3 个字），检索当前会话的知识库...'
                : '输入任务，回车执行...'
            "
            rows="3"
            :disabled="isLoading"
            class="textarea-input"
            @keydown.enter.prevent="sendMessage"
          />
          <button
            type="button"
            class="kb-toggle"
            :class="{ active: useKnowledgeBase }"
            :disabled="isLoading"
            :title="
              useKnowledgeBase
                ? '已开启：仅在当前会话知识库中检索'
                : '开启后仅走知识库检索，不调用大模型'
            "
            @click="useKnowledgeBase = !useKnowledgeBase"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" class="kb-icon">
              <path
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M4 4h12a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V4zM4 17a3 3 0 0 1 3-3h12"
              />
            </svg>
            <span>知识库</span>
          </button>
          <button
            class="send-button"
            :disabled="!canSubmit"
            :title="sendButtonTitle"
            @click="sendMessage"
          >
            <svg
              v-if="!isLoading"
              class="send-icon"
              viewBox="0 0 24 24"
              width="16"
              height="16"
            >
              <path
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M12 20V4M5 11l7-7 7 7"
              />
            </svg>
            <svg
              v-else
              class="loading-icon"
              viewBox="0 0 24 24"
              width="16"
              height="16"
            >
              <path
                fill="currentColor"
                d="M12 4V2C6.48 2 2 6.48 2 12H4C4 7.58 7.58 4 12 4Z"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import JsonBlock from '@/components/JsonBlock.vue';
import ListBlock from '@/components/ListBlock.vue';
import LoadingDots from '@/components/LoadingDots.vue';
import MarkdownBlock from '@/components/MarkdownBlock.vue';
import SessionPanel, {
  type SessionSummary,
} from '@/components/SessionPanel.vue';
import ToolBlock from '@/components/ToolBlock.vue';
import UsageBlock from '@/components/UsageBlock.vue';
import type { ContentBlock } from '@ai-agent/common';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { computed, onMounted, ref, type Component } from 'vue';
import { formatSearchHits } from '@/utils/searchHighlight';

/** 后端 HistoryMessage 的最小契约（与 apps/agent/.../history.types.ts 对齐） */
interface HistoryMessageDTO {
  id?: number;
  sessionId: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolName?: string | null;
  raw?: string | null;
  createdAt: number;
}

/**
 * Content Block 协议（对齐 OpenAI / Anthropic 风格）
 * 每条 SSE data 就是一个 ContentBlock，前端仅根据 type 分发渲染。
 * 类型定义位于 @ai-agent/common，前后端共享同一份契约。
 */
interface ChatMessage {
  role: 'user' | 'assistant';
  block: ContentBlock;
}

// 类型 → 渲染组件 的映射（新增类型只需在此登记）
const RENDERER_MAP: Record<ContentBlock['type'], Component | null> = {
  text: MarkdownBlock,
  list: ListBlock,
  json: JsonBlock,
  tool_use: ToolBlock,
  usage: UsageBlock,
  done: null,
  session: null,
};

// 将 block 归一化为对应渲染组件的 props
const rendererProps = (block: ContentBlock): Record<string, unknown> => {
  switch (block.type) {
    case 'text':
      return { content: block.text };
    case 'list':
      return { items: block.items };
    case 'json':
      return { content: block.data };
    case 'tool_use':
      return { items: [block.name] };
    case 'usage':
      return {
        inputTokens: block.inputTokens,
        outputTokens: block.outputTokens,
        totalTokens: block.totalTokens,
        llmCalls: block.llmCalls,
      };
    default:
      return {};
  }
};

const wrapperClass = (type: ContentBlock['type']) =>
  type === 'json' ? '' : 'message-content';

const messages = ref<ChatMessage[]>([]);
const userInput = ref('');
const messageContainer = ref<HTMLElement | null>(null);
const isLoading = ref(false);
const useKnowledgeBase = ref(false); // 是否切换到"知识库检索"模式
const KB_MIN_QUERY_LENGTH = 3; // 知识库检索关键词的最小长度

const canSubmit = computed(() => {
  if (isLoading.value) return false;
  const trimmed = userInput.value.trim();
  if (!trimmed) return false;
  return !(useKnowledgeBase.value && trimmed.length < KB_MIN_QUERY_LENGTH);
});

/** 发送按钮的 title：给用户一个明确的反馈原因 */
const sendButtonTitle = computed(() => {
  if (isLoading.value) return '发送中...';
  if (
    useKnowledgeBase.value &&
    userInput.value.trim().length > 0 &&
    userInput.value.trim().length < KB_MIN_QUERY_LENGTH
  ) {
    return `知识库检索至少输入 ${KB_MIN_QUERY_LENGTH} 个字`;
  }
  return '发送';
});

/** 后端 FTS5 命中结构（与 apps/agent/.../history.types.ts 对齐） */
interface HistorySearchHitDTO {
  id?: number;
  sessionId: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolName?: string | null;
  createdAt: number;
  snippet: string; // 已在服务端拼好 <mark> 高亮的片段
}

/**
 * 会话 ID：优先从 localStorage 恢复，后端首帧 `session` block 会覆写。
 * - 初次访问时为 null，发送时不带 sessionId，后端会自动新建并下发。
 * - 逆向兼容：若后端校验失败也会重新下发新 id，前端直接覆写即可。
 */
const SESSION_STORAGE_KEY = 'ai-agent:sessionId';
const sessionId = ref<string | null>(localStorage.getItem(SESSION_STORAGE_KEY));

const persistSessionId = (id: string) => {
  if (sessionId.value === id) return;
  sessionId.value = id;
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, id);
  } catch {
    // 隐私模式下 localStorage 可能不可用，忽略即可
  }
};

/**
 * 把后端持久化的 HistoryMessage 还原为前端 ChatMessage。
 */
const historyToChatMessage = (msg: HistoryMessageDTO): ChatMessage | null => {
  if (msg.role === 'system') return null;
  if (!msg.content?.trim()) return null;

  if (msg.role === 'user') {
    return { role: 'user', block: { type: 'text', text: msg.content } };
  }

  if (msg.role === 'assistant') {
    return { role: 'assistant', block: { type: 'text', text: msg.content } };
  }

  // tool：尝试还原为更结构化的展示
  let parsed: unknown = msg.content;
  try {
    parsed = JSON.parse(msg.content);
  } catch {
    // 保持原字符串
  }

  if (parsed && typeof parsed === 'object') {
    const results = (parsed as { results?: unknown }).results;
    if (Array.isArray(results)) {
      const items = results
        .filter(
          (r): r is Record<string, unknown> => !!r && typeof r === 'object',
        )
        .map((r) => ({
          title: typeof r.title === 'string' ? r.title : '',
          url: typeof r.url === 'string' ? r.url : '',
        }))
        .filter((it) => it.title && it.url);
      if (items.length) {
        return { role: 'assistant', block: { type: 'list', items } };
      }
    }
    return {
      role: 'assistant',
      block: { type: 'json', data: parsed as Record<string, unknown> },
    };
  }

  return { role: 'assistant', block: { type: 'text', text: msg.content } };
};

/**
 * 页面挂载时，如果本地已经存有 sessionId，则拉取该会话的历史消息并回放。
 *
 * - 后端 404（session 已被清理）→ 清空 localStorage，等下一轮对话新建。
 * - 网络异常 → 静默降级，不影响首次发送。
 */
const restoreHistory = async () => {
  const id = sessionId.value;
  if (!id) return;

  try {
    const resp = await fetch(
      `/agent/sessions/${encodeURIComponent(id)}/messages`,
    );
    if (resp.status === 404) {
      sessionId.value = null;
      try {
        localStorage.removeItem(SESSION_STORAGE_KEY);
      } catch {
        // ignore
      }
      return;
    }
    if (!resp.ok) return;

    const rows = (await resp.json()) as HistoryMessageDTO[];
    const restored = rows
      .map(historyToChatMessage)
      .filter((m): m is ChatMessage => m !== null);
    if (restored.length) {
      messages.value = restored;
      scrollToBottom();
    }
  } catch (err) {
    console.warn('恢复历史消息失败:', err);
  }
};

// ===================== 会话列表与面板状态 =====================

const sessionList = ref<SessionSummary[]>([]);
const sessionsLoading = ref(false);
const panelCollapsed = ref(false);

/** 拉取会话列表，失败时静默降级（不阻断主流程） */
const fetchSessions = async () => {
  sessionsLoading.value = true;
  try {
    const resp = await fetch('/agent/sessions');
    if (!resp.ok) return;
    sessionList.value = (await resp.json()) as SessionSummary[];
  } catch (err) {
    console.warn('拉取会话列表失败:', err);
  } finally {
    sessionsLoading.value = false;
  }
};

/**
 * 切换到指定会话：写回 sessionId + 清空当前消息 + 回放历史。
 * 如果目标就是当前会话则直接返回，避免无谓重新拉取。
 */
const handleSelectSession = async (id: string) => {
  if (id === sessionId.value) return;
  persistSessionId(id);
  messages.value = [];
  await restoreHistory();
};

/**
 * 新建会话：直接调 POST /agent/sessions 拿到 id 后写入本地，
 * 并把新会话插到列表顶部。不预先发布完整列表，避免与后端排序字段不一致。
 */
const handleCreateSession = async () => {
  try {
    sessionsLoading.value = true;
    const resp = await fetch('/agent/sessions', { method: 'POST' });
    if (!resp.ok) return;
    const created = (await resp.json()) as SessionSummary;
    // 新会话置顶，同时切换为当前，清空消息列表
    sessionList.value = [created, ...sessionList.value];
    persistSessionId(created.id);
    messages.value = [];
  } catch (err) {
    console.warn('新建会话失败:', err);
  } finally {
    sessionsLoading.value = false;
  }
};

/**
 * 删除会话：后端成功后从列表剔除。
 * 若删的正好是当前会话，清空本地 sessionId + 消息，等下一轮对话时后端自动新建。
 */
const handleDeleteSession = async (id: string) => {
  if (!window.confirm('确定删除该会话？删除后无法恢复。')) return;

  try {
    const resp = await fetch(`/agent/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!resp.ok) return;

    sessionList.value = sessionList.value.filter((s) => s.id !== id);
    if (id === sessionId.value) {
      sessionId.value = null;
      try {
        localStorage.removeItem(SESSION_STORAGE_KEY);
      } catch {
        // ignore
      }
      messages.value = [];
    }
  } catch (err) {
    console.warn('删除会话失败:', err);
  }
};

onMounted(() => {
  void restoreHistory();
  void fetchSessions();
});

const scrollToBottom = async () => {
  setTimeout(() => {
    if (messageContainer.value) {
      messageContainer.value.scrollTop = messageContainer.value.scrollHeight;
    }
  }, 0);
};

const pushAssistantBlock = (block: ContentBlock) => {
  // 不需要入消息流的控制型 block
  if (block.type === 'done' || block.type === 'session') return;
  messages.value.push({ role: 'assistant', block });
  scrollToBottom();
};

/**
 * 知识库检索分支：不走 LLM，只调用 GET /agent/sessions/:id/search，
 * 将命中片段以 markdown 列表形式回显为一条 assistant text block。
 * 无 sessionId（尚未发起过对话）或无命中时给出友好提示。
 */
const searchKnowledgeBase = async (query: string) => {
  if (!sessionId.value) {
    pushAssistantBlock({
      type: 'text',
      text: '当前还没有会话，先发起一次对话再使用知识库检索吧。',
    });
    return;
  }

  try {
    isLoading.value = true;
    const params = new URLSearchParams({ q: query });
    const url = `/agent/sessions/${encodeURIComponent(sessionId.value)}/search?${params.toString()}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      pushAssistantBlock({
        type: 'text',
        text: `知识库检索失败：HTTP ${resp.status}`,
      });
      return;
    }
    const hits = (await resp.json()) as HistorySearchHitDTO[];
    // 命中格式化 / 高亮 / 折叠块渲染均下沉到公共方法，见 utils/searchHighlight.ts
    pushAssistantBlock({
      type: 'text',
      text: formatSearchHits(hits, query),
    });
  } catch (err) {
    console.error('知识库检索异常:', err);
    pushAssistantBlock({
      type: 'text',
      text: '知识库检索失败，请稍后重试。',
    });
  } finally {
    isLoading.value = false;
    scrollToBottom();
  }
};

const sendMessage = async () => {
  if (!userInput.value.trim() || isLoading.value) return;

  // 知识库模式：至少 3 个字才允许发起检索
  const trimmedInput = userInput.value.trim();
  if (useKnowledgeBase.value && trimmedInput.length < KB_MIN_QUERY_LENGTH) {
    pushAssistantBlock({
      type: 'text',
      text: `知识库检索至少需要输入 ${KB_MIN_QUERY_LENGTH} 个字。`,
    });
    return;
  }

  // 用户消息统一走 text block
  messages.value.push({
    role: 'user',
    block: { type: 'text', text: userInput.value },
  });

  const userMessage = userInput.value;
  userInput.value = '';
  scrollToBottom();

  // 「知识库」按钮开启时，走独立的 FTS 检索通道，不调用大模型
  if (useKnowledgeBase.value) {
    await searchKnowledgeBase(userMessage);
    return;
  }

  try {
    isLoading.value = true;

    // 拼接 query：首次会话 sessionId 为空，后端会新建并于首帧下发
    const params = new URLSearchParams({ message: userMessage });
    if (sessionId.value) params.set('sessionId', sessionId.value);

    await fetchEventSource(`/agent/invoke?${params.toString()}`, {
      onmessage(event) {
        if (!event.data) return;

        let block: ContentBlock;
        try {
          block = JSON.parse(event.data) as ContentBlock;
        } catch {
          // 兜底：非 JSON 字符串按文本处理
          block = { type: 'text', text: event.data };
        }

        // 兜底：老协议 { done: true } → done block
        if ((block as any).done === true) return;

        if (!block.type || !(block.type in RENDERER_MAP)) return;

        // 首帧 session：只存不渲染
        if (block.type === 'session') {
          persistSessionId(block.id);
          return;
        }

        pushAssistantBlock(block);
      },
      onerror(error) {
        console.error('Stream error:', error);
      },
    });

    // 本轮结束：刷新会话列表以便 title / updatedAt / 新建的会话及时呈现
    void fetchSessions();
  } catch (error) {
    pushAssistantBlock({
      type: 'text',
      text: '抱歉，服务器出现错误，请稍后再试。',
    });
    console.error('Chat API error:', error);
  } finally {
    isLoading.value = false;
    scrollToBottom();
  }
};
</script>

<style scoped>
.chat-layout {
  display: flex;
  height: 100vh;
  width: 100%;
  box-sizing: border-box;
}

.chat-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 5px;
  box-sizing: border-box;
  min-width: 0;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  background: #f6f6f6;
  border-radius: 10px;
  padding: 20px;
  min-height: 0;
}

.message {
  display: flex;
  margin-bottom: 10px;
  gap: 12px;
  position: relative;
}

.message-content {
  background: #fff;
  padding: 3px 10px;
  font-size: 13px;
  border-radius: 12px 12px 0 12px;
  margin-bottom: 5px;
  user-select: text;
  cursor: pointer;
  position: relative;

  code {
    color: #1565c0;
    margin: 0 2px;
  }

  a {
    color: hsla(160, 100%, 37%, 1);
    text-decoration: none;
    font-size: 12px;
  }
}

.message.assistant .message-content {
  background: #fff;
  border-radius: 0 12px 12px 12px;
}

.message.user {
  justify-content: flex-end;
}

.chat-input {
  flex-shrink: 0;
  margin-top: 10px;
  display: flex;
  gap: 10px;
  width: 100%;
}

.input-wrapper {
  position: relative;
  flex: 1;
  width: 100%;
}

.send-button {
  position: absolute;
  right: 10px;
  bottom: 15px;
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 50%;
  background: #1976d2;
  color: white;
  border: none;
  cursor: pointer;
  min-width: unset;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s;
}

.send-button:hover:not(:disabled) {
  background: #1565c0;
  transform: scale(1.05);
}

.send-button:disabled {
  background: #e0e0e0;
  cursor: not-allowed;
}

.send-icon {
  display: block;
}

.loading-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

.textarea-input {
  width: 100%;
  padding: 12px;
  padding-bottom: 40px;
  padding-right: 50px;
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  resize: none;
  font-family: inherit;
}

.kb-toggle {
  position: absolute;
  left: 10px;
  bottom: 15px;
  height: 28px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  border: 1px solid #d0d7de;
  border-radius: 14px;
  background: #fff;
  color: #57606a;
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;
}

.kb-toggle:hover:not(:disabled) {
  border-color: #1976d2;
  color: #1976d2;
}

.kb-toggle.active {
  background: transparent;
  border-color: #1976d2;
  color: #1976d2;
}

.kb-toggle.active:hover:not(:disabled) {
  background: #1976d2;
  border-color: #1976d2;
  color: #fff;
}

.kb-toggle:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.kb-icon {
  display: block;
}

.textarea-input:disabled {
  background: #e8e8e8;
  cursor: not-allowed;
}

.textarea-input:focus {
  outline: none;
  border: 1px solid #1565c0;
  box-shadow: none;
}
</style>

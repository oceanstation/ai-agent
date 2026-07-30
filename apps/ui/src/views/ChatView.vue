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
      <div
        ref="messageContainer"
        class="chat-messages"
      >
        <div
          v-for="message in messages"
          :key="message.id"
          v-memo="[message.block]"
          :class="['message', message.role]"
        >
          <details
            v-if="isToolResult(message.block)"
            class="tool-result"
          >
            <summary class="tool-result__summary">
              <span class="tool-result__badge">工具返回</span>
              <span class="tool-result__label">{{ toolResultLabel(message.block) }}</span>
              <svg
                class="tool-result__chevron"
                viewBox="0 0 12 12"
                width="10"
                height="10"
                aria-hidden="true"
              >
                <path
                  fill="currentColor"
                  d="M4 2.5 L8.5 6 L4 9.5 Z"
                />
              </svg>
            </summary>
            <div class="tool-result__content">
              <component
                :is="RENDERER_MAP[message.block.type]"
                v-bind="rendererProps(message.block)"
              />
            </div>
          </details>
          <component
            :is="RENDERER_MAP[message.block.type]"
            v-else
            v-bind="rendererProps(message.block)"
            :class="wrapperClass(message.block.type)"
          />
        </div>
        <div
          v-if="isLoading"
          class="message assistant"
        >
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
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              class="kb-icon"
            >
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
import SessionPanel from '@/components/SessionPanel.vue';
import SpecGateBlock from '@/components/SpecGateBlock.vue';
import ToolBlock from '@/components/ToolBlock.vue';
import UsageBlock from '@/components/UsageBlock.vue';
import type { ContentBlock } from '@ai-agent/common';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { computed, onMounted, ref, type Component } from 'vue';
import { formatSearchHits } from '@/utils/searchHighlight';
import { useChatSession } from '@/composables/useChatSession';

// 类型 → 渲染组件 的映射（新增类型只需在此登记）
const RENDERER_MAP: Record<ContentBlock['type'], Component | null> = {
  text: MarkdownBlock,
  list: ListBlock,
  json: JsonBlock,
  tool_use: ToolBlock,
  usage: UsageBlock,
  spec_gate: SpecGateBlock,
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
      return {
        items: [block.name],
        inputs: [block.input],
        kind: block.kind ?? 'tool',
      };
    case 'usage':
      return {
        inputTokens: block.inputTokens,
        outputTokens: block.outputTokens,
        totalTokens: block.totalTokens,
        llmCalls: block.llmCalls,
        model: block.model,
      };
    case 'spec_gate':
      return {
        featureId: block.featureId,
        phase: block.phase,
        path: block.path,
        pendingApproval: block.pendingApproval,
        timeline: block.timeline,
        onApproved: handleSpecGateApproved,
      };
    default:
      return {};
  }
};

const wrapperClass = (type: ContentBlock['type']) =>
  type === 'json' || type === 'spec_gate' ? '' : 'message-content';

/** 是否是"工具返回的原始产物"—— 后端在 block 上打了 source:'tool' 标记 */
const isToolResult = (block: ContentBlock): boolean =>
  (block as { source?: string }).source === 'tool';

/** 折叠面板标题，尽量给出内容形态的提示，让用户判断是否需要展开 */
const toolResultLabel = (block: ContentBlock): string => {
  switch (block.type) {
    case 'text':
      return `文本 · ${block.text.length} 字`;
    case 'list':
      return `列表 · ${block.items.length} 项`;
    case 'json':
      return '结构化数据';
    default:
      return '';
  }
};

const {
  sessionId,
  messages,
  sessionList,
  sessionsLoading,
  restoreHistory,
  fetchSessions,
  selectSession,
  createSession,
  deleteSession,
  persistSessionId,
  appendUserMessage,
  appendAssistantBlock,
} = useChatSession();

const userInput = ref('');
const messageContainer = ref<HTMLElement | null>(null);
const isLoading = ref(false);
const useKnowledgeBase = ref(false); // 是否切换到"知识库检索"模式
const panelCollapsed = ref(false);
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

const scrollToBottom = () => {
  setTimeout(() => {
    if (messageContainer.value) {
      messageContainer.value.scrollTop = messageContainer.value.scrollHeight;
    }
  }, 0);
};

const pushAssistantBlock = (block: ContentBlock) => {
  appendAssistantBlock(block);
  scrollToBottom();
};

const handleSelectSession = async (id: string) => {
  await selectSession(id);
  scrollToBottom();
};
const handleCreateSession = () => createSession();
const handleDeleteSession = (id: string) => deleteSession(id);

onMounted(async () => {
  await restoreHistory();
  scrollToBottom();
  void fetchSessions();
});

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
  appendUserMessage(userInput.value);

  const userMessage = userInput.value;
  userInput.value = '';
  scrollToBottom();

  // 「知识库」按钮开启时，走独立的 FTS 检索通道，不调用大模型
  if (useKnowledgeBase.value) {
    await searchKnowledgeBase(userMessage);
    return;
  }

  await runAgentTurn(userMessage);
};

/**
 * 发起一次 /agent/invoke SSE 调用，逐帧消费并转发到消息流。
 * 用户输入与 SDD 阶段批准回调都会走这条通道。
 */
const runAgentTurn = async (message: string) => {
  try {
    isLoading.value = true;

    // 拼接 query：首次会话 sessionId 为空，后端会新建并于首帧下发
    const params = new URLSearchParams({ message });
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

/**
 * SDD 阶段批准回调：用户点击"批准"后由 SpecGateBlock 组件触发。
 * 后端已把 approvedAt 落库，这里滞后 700ms 再发下一轮 agent 请求，
 * 让用户在时间线里先看到当前阶段变绿，再触发模型进入下一阶段。
 */
const handleSpecGateApproved = (payload: {
  featureId: string;
  phase: string;
}) => {
  const nextPhase = ({
    specify: 'plan',
    plan: 'tasks',
    tasks: 'implement',
  } as Record<string, string>)[payload.phase];
  if (!nextPhase) return;
  const prompt =
    `我已批准 feature \`${payload.featureId}\` 的 ${payload.phase} 阶段。` +
    `请加载 sdd-${nextPhase} skill 并进入 ${nextPhase} 阶段。`;
  window.setTimeout(() => {
    void runAgentTurn(prompt);
  }, 700);
};
</script>

<style scoped>
/* ---------- Tool result：默认折叠的工具产物 ---------- */
.tool-result {
  max-width: 75%;
  border-radius: 6px;
  background: #fff;
  overflow: hidden;
  transition: border-color 0.15s;
}

.tool-result[open] {
  border-color: #d0d7de;
}

.tool-result__summary {
  cursor: pointer;
  padding: 8px 12px;
  font-size: 12px;
  color: #57606a;
  user-select: none;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: background 0.15s, color 0.15s;
}

/* 隐藏浏览器默认的三角标记，用自定义 chevron */
.tool-result__summary::-webkit-details-marker,
.tool-result__summary::marker {
  display: none;
}

.tool-result__badge {
  padding: 2px 8px;
  border-radius: 3px;
  background: #eef1f4;
  color: #57606a;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  flex-shrink: 0;
}

.tool-result__label {
  color: #57606a;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}

.tool-result__chevron {
  color: #8c959f;
  transition: transform 0.2s ease;
  flex-shrink: 0;
  display: block;
}

.tool-result[open] > .tool-result__summary .tool-result__chevron {
  transform: rotate(90deg);
}

.tool-result__summary:hover {
  background: #f6f8fa;
  color: #24292f;
}

.tool-result__summary:hover .tool-result__label,
.tool-result__summary:hover .tool-result__chevron {
  color: #24292f;
}

.tool-result__summary:hover .tool-result__badge {
  background: #e1e4e8;
  color: #24292f;
}

.tool-result__content {
  border-top: 1px solid #eaecef;
  padding: 10px 14px;
  background: #fafbfc;
  font-size: 13px;
  line-height: 1.6;
  color: #24292f;
  max-height: 420px;
  overflow-y: auto;
}

/* 内部再嵌套 code / pre 时，保持扁平背景，无阴影 */
.tool-result__content :deep(pre),
.tool-result__content :deep(code) {
  background: #fff;
  box-shadow: none;
}

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
  margin-bottom: 14px;
  gap: 12px;
  position: relative;
}

.message-content {
  padding: 0 10px;
  font-size: 13px;
  line-height: 1.6;
  max-width: 75%;
  user-select: text;
  cursor: pointer;
  position: relative;
  word-break: break-word;
}

/* ---------- User：品牌蓝渐变气泡 ---------- */
.message.user {
  justify-content: flex-end;
}

.message.user .message-content {
  background: linear-gradient(135deg, var(--brand-500) 0%, var(--brand-700) 100%);
  color: #fff;
  border-radius: 14px 14px 4px 14px; /* 右下小尖角，指向用户侧 */
}

/* 用户气泡内的链接与行内 code 需要在蓝底上重新调色，保证对比度 */
.message.user .message-content :deep(a) {
  color: var(--brand-fg-on-brand);
  text-decoration: underline;
}

.message.user .message-content :deep(:not(pre) > code) {
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
}

/* ---------- Assistant：白底扁平卡片 ---------- */
.message.assistant .message-content {
  background: #fff;
  color: #1f2328;
  border-radius: 14px 14px 14px 4px; /* 左下小尖角，指向 AI 侧 */
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
  background: var(--brand-600);
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
  background: var(--brand-700);
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
  border-color: var(--brand-600);
  color: var(--brand-600);
}

.kb-toggle.active {
  background: transparent;
  border-color: var(--brand-600);
  color: var(--brand-600);
}

.kb-toggle.active:hover:not(:disabled) {
  background: var(--brand-600);
  border-color: var(--brand-600);
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
  border: 1px solid var(--brand-700);
  box-shadow: none;
}
</style>

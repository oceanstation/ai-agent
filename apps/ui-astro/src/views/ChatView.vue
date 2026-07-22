<template>
  <div class="chat-container">
    <div
      ref="messageContainer"
      class="chat-messages"
    >
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
      <div
        v-if="isLoading"
        class="message assistant"
      >
        <LoadingDots />
      </div>

      <!-- 底部输入框 -->
      <div class="chat-input">
        <div class="input-wrapper">
          <textarea
            v-model="userInput"
            placeholder="输入任务，回车执行..."
            rows="3"
            :disabled="isLoading"
            class="textarea-input"
            @keydown.enter.prevent="sendMessage"
          />
          <button
            class="send-button"
            :disabled="!userInput.trim() || isLoading"
            :title="isLoading ? '发送中...' : '发送'"
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
import ToolBlock from '@/components/ToolBlock.vue';
import type { ContentBlock } from '@ai-agent/common';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { ref, type Component } from 'vue';

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
  done: null,
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

const scrollToBottom = async () => {
  setTimeout(() => {
    if (messageContainer.value) {
      messageContainer.value.scrollTop = messageContainer.value.scrollHeight;
    }
  }, 0);
};

const pushAssistantBlock = (block: ContentBlock) => {
  if (block.type === 'done') return;
  messages.value.push({ role: 'assistant', block });
  scrollToBottom();
};

const sendMessage = async () => {
  if (!userInput.value.trim() || isLoading.value) return;

  // 用户消息统一走 text block
  messages.value.push({
    role: 'user',
    block: { type: 'text', text: userInput.value },
  });

  const userMessage = userInput.value;
  userInput.value = '';
  scrollToBottom();

  try {
    isLoading.value = true;

    await fetchEventSource(`/agent/invoke?message=${userMessage}`, {
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
        pushAssistantBlock(block);
      },
      onerror(error) {
        console.error('Stream error:', error);
      },
    });
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
.chat-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  margin: 0 auto;
  padding: 5px;
  box-sizing: border-box;
  max-width: 888px;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  background: #f6f6f6;
  border-radius: 10px;
  padding: 20px 20px 120px 20px;
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
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  margin: 0 auto;
  display: flex;
  gap: 10px;
  width: 95%;
  min-width: 300px;
  max-width: 800px;
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

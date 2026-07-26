<template>
  <div
    v-for="(item, index) in items"
    :key="index"
    class="tool"
    :class="{ 'tool--subagent': kind === 'subagent' }"
  >
    <!-- subagent 用专属图标 + 呼吸动画，普通 tool 保持原有 svg 图标 -->
    <img
      v-if="kind === 'subagent'"
      :src="subagentIcon"
      alt="SubAgent"
      class="icon icon--subagent"
    >
    <img
      v-else
      :src="toolIcon"
      alt="执行工具"
      class="icon"
    >
    <template v-if="kind === 'subagent'">
      SubAgent·
      <span class="name">{{ item }}</span>
      <span
        v-if="summaries[index]"
        class="keyword"
      >
        → {{ summaries[index] }}</span>
    </template>
    <template v-else>
      执行工具 <span class="name">{{ item }}</span>
      <span
        v-if="summaries[index]"
        class="query"
      >
        → {{ summaries[index] }}</span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import toolIcon from '@/assets/tools.svg';
import subagentIcon from '@/assets/favicon.svg';

/**
 * ToolBlock 组件 props：
 * - items：工具名列表（一条 AI 消息里可能同时并发多个 tool_call）
 * - inputs：与 items 一一对应的入参对象；用于生成可读的摘要
 * - kind：'tool'（默认，普通工具） / 'subagent'（子代理，用更醒目的样式）
 */
const props = withDefaults(
  defineProps<{
    items: string[];
    inputs?: Array<Record<string, unknown> | undefined>;
    kind?: 'tool' | 'subagent';
  }>(),
  { kind: 'tool', inputs: () => [] },
);

/**
 * 优先展示的入参字段名
 */
const PREFERRED_KEYS = ['query'] as const;

/** 摘要最大长度；超出则中间省略，保留首尾便于识别 */
const MAX_LEN = 60;

/**
 * 从 input 对象里挑一个最能代表本次调用意图的字符串值
 */
function pickPrimaryValue(input?: Record<string, unknown>): string {
  if (!input || typeof input !== 'object') return '';
  for (const key of PREFERRED_KEYS) {
    const v = input[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/** 长文本中间截断：首 30 + … + 尾 20，保留两头关键字信息 */
function truncate(text: string): string {
  if (text.length <= MAX_LEN) return text;
  return `${text.slice(0, 36)}…${text.slice(-16)}`;
}

/** 与 items 一一对应的摘要文案 */
const summaries = computed(() =>
  props.items.map((_, i) => truncate(pickPrimaryValue(props.inputs?.[i]))),
);
</script>

<style scoped>
.tool {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #666;
  padding: 0;
  font-size: 12px;

  .icon {
    width: 15px;
    height: 15px;
    opacity: 0.7;
  }

  .name {
    font-size: 13px;
  }

  .keyword {
    color: #888;
    font-size: 12px;
    max-width: 420px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

/* subagent：更醒目的配色 + 呼吸灯 */
.tool--subagent {
  color: #4b5cff;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: 6px;
  background: linear-gradient(
    90deg,
    rgba(75, 92, 255, 0.08),
    rgba(75, 92, 255, 0)
  );
  animation: subagent-pulse 1.6s ease-in-out infinite;

  .icon--subagent {
    width: 16px;
    height: 16px;
    opacity: 1;
  }

  .name {
    font-weight: 600;
    color: #2d3fd8;
  }

  .keyword {
    color: #4b5cff;
    font-weight: 400;
  }
}

@keyframes subagent-pulse {
  0%,
  100% {
    opacity: 0.75;
  }
  50% {
    opacity: 1;
  }
}
</style>

<template>
  <div class="usage">
    <span title="本轮 token 总量">{{ totalTokens.toLocaleString() }}tk</span>
    <span title="输入 token">↑{{ inputTokens.toLocaleString() }}</span>
    <span title="输出 token">↓{{ outputTokens.toLocaleString() }}</span>
    <span title="本轮 LLM 调用次数">{{ llmCalls }}x</span>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  llmCalls: number;
}>();
</script>

<style scoped>
.usage {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 2px;
  margin-top: -10px;
  color: #979797;
  font-size: 10px; /* 保底：≥ 浏览器最小字号，避免被 UA 拉伸破坏 scale 精度 */
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  opacity: 0.75;
  user-select: none;

  transform: scale(0.75); /* 视觉字号 ≈ 7.5px */
  transform-origin: left top;
}
</style>

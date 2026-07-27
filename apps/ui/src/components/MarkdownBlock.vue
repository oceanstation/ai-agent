<template>
  <div
    class="markdown"
    v-html="renderedContent"
  />
</template>

<script setup lang="ts">
import DOMPurify from 'dompurify';
import { computed } from 'vue';
import { md } from './markdownRenderer';

const props = defineProps<{
  content: string;
}>();

const renderedContent = computed(() =>
  DOMPurify.sanitize(md.render(props.content)),
);
</script>

<style scoped>
.markdown {
  font-size: 13px;
  position: relative;
  line-height: 1.6;
}

:deep(ul) {
  padding-inline-start: 15px;
}

:deep(ol) {
  padding-inline-start: 15px;
}

/* 代码块样式 */
:deep(pre) {
  border-radius: 8px;
  padding: 12px 16px;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.5;
  margin: 8px 0;
}

:deep(pre code) {
  font-family:
    'JetBrains Mono', 'Fira Code', 'Menlo', 'Monaco', 'Consolas', monospace;
}

/* 行内代码 */
:deep(:not(pre) > code) {
  background: #f3f4f6;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
  font-family:
    'JetBrains Mono', 'Fira Code', 'Menlo', 'Monaco', 'Consolas', monospace;
  color: #d63384;
}

:deep(pre.kb-full) {
  background: #fafafa;
  border: 1px solid #eee;
  padding: 8px 12px;
  margin: 4px 0;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.55;
  font-family: inherit;
  white-space: pre-wrap; /* 保留换行 + 自动软换行，避免横向溢出 */
  word-break: break-word;
  max-height: 320px;
  overflow-y: auto;
}

:deep(mark) {
  color: hsla(160, 100%, 37%, 0.8);
  background: #ffffff;
  padding: 0 2px;
  border-radius: 5px;
}

:deep(hr) {
  border: none;
  height: 1px;
  margin: 3px 0;
  background: linear-gradient(
    to right,
    transparent,
    rgba(0, 0, 0, 0.12) 20%,
    rgba(0, 0, 0, 0.12) 80%,
    transparent
  );
}

/* 折叠块（details/summary）：自定义展开图标，替换浏览器默认三角 marker */
:deep(details) {
  margin: 4px 0;
}

/* 隐藏默认 marker（覆盖 Chrome / Safari / Firefox 三种写法） */
:deep(details > summary) {
  list-style: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 12px;
  color: #555;
  user-select: none;
  transition: background-color 0.15s ease;
}

:deep(details > summary::-webkit-details-marker) {
  display: none;
}

:deep(details > summary::marker) {
  content: '';
}

:deep(details > summary:hover) {
  background: rgba(0, 0, 0, 0.04);
  color: #222;
}
</style>

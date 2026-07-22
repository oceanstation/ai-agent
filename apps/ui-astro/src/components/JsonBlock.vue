<template>
  <div class="json-viewer-wrapper">
    <JsonViewer
      :value="props.content"
      boxed
      sort
      theme="light"
      :expand-depth="3"
      :copyable="false"
    />
  </div>
</template>

<script setup lang="ts">
// vue3-json-viewer 依赖 window，在 Astro 里由 client:only 的父级挂载确保仅在浏览器执行
import { JsonViewer } from 'vue3-json-viewer';
import 'vue3-json-viewer/dist/vue3-json-viewer.css';

const props = defineProps<{
  content: Record<string, any>
}>()
</script>

<style scoped>
:deep(.jv-container .jv-code) {
  padding: 5px 10px;
}

:deep(.jv-container.jv-light) {
  font-size: 12px;
}
</style>

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

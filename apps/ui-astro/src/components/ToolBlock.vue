<template>
  <div
    v-for="(item, index) in items"
    :key="index"
    class="tool"
  >
    <img
      src="/tools.svg"
      alt="执行工具"
      class="icon"
    >
    执行工具 <span>{{ item }}</span>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  items: string[]
}>()
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

  span {
    font-size: 13px;
  }
}
</style>

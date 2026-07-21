<template>
  <div>
    <div class="list-header">
      <img
        :src="basketIcon"
        alt="执行结果"
        class="icon"
      >执行结果
    </div>
    <div
      v-for="(item, index) in items"
      :key="index"
    >
      <a
        :href="item.url"
        target="_blank"
        class="list-item"
      >
        <span
          v-if="items.length > 1"
          class="list-number"
        >{{ index + 1 }}</span>
        {{ item.title }}
      </a>
    </div>
  </div>
</template>

<script setup lang="ts">
import basketIcon from '@/assets/basket.svg';

interface ListItem {
  title: string;
  url: string;
}

defineProps<{
  items: ListItem[];
}>();
</script>

<style scoped>
.list-header {
  display: flex;
  align-items: center;
  gap: 3px;
  color: #666;
  text-decoration: none;

  .icon {
    width: 15px;
    height: 15px;
    opacity: 0.7;
  }
}

.list-item {
  display: flex;
  align-items: center;
  gap: 3px;
  color: #666;
}

.list-number {
  font-weight: bold;
  font-size: 7px;
  background: hsla(160, 100%, 37%, 0.8);
  color: #fff;
  border-radius: 4px;
  padding: 0 3px;
  width: 11px;
}
</style>

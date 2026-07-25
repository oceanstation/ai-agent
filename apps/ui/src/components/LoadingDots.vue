<template>
  <div class="message-content loading">
    <span />
    <span />
    <span />
  </div>
</template>

<script setup lang="ts">
// 无需额外的逻辑
</script>

<style scoped>
.loading {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 20px;
}

.loading span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--brand-600);
  animation: bounce 1.4s infinite ease-in-out both;
}

.loading span:nth-child(1) {
  animation-delay: -0.32s;
}

.loading span:nth-child(2) {
  animation-delay: -0.16s;
}

@keyframes bounce {
  0%,
  80%,
  100% {
    transform: scale(0);
  }

  40% {
    transform: scale(1);
  }
}
</style>

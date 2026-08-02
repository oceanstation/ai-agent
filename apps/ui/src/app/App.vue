<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div class="app-shell">
    <nav class="app-nav">
      <RouterLink
        to="/"
        class="app-nav__link"
        active-class="app-nav__link--active"
        exact-active-class="app-nav__link--active"
      >
        聊天
      </RouterLink>
      <RouterLink
        to="/knowledge"
        class="app-nav__link"
        active-class="app-nav__link--active"
      >
        知识库
      </RouterLink>
    </nav>
    <RouterView />
  </div>
</template>

<style scoped>
.app-shell {
  height: 100vh;
  width: 100%;
  overflow: hidden;
}

/* 悬浮在页面右上角的小切换器，避免侵入 ChatView / KnowledgeView 的内部布局 */
.app-nav {
  position: fixed;
  top: 12px;
  right: 16px;
  z-index: 20;
  display: flex;
  gap: 4px;
  padding: 4px;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(8px);
  border: 1px solid #e8e8e8;
  border-radius: 999px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.app-nav__link {
  padding: 4px 12px;
  font-size: 12px;
  color: #57606a;
  text-decoration: none;
  border-radius: 999px;
  transition: background 0.15s, color 0.15s;
}

.app-nav__link:hover {
  color: var(--brand-600);
}

.app-nav__link--active {
  background: var(--brand-600);
  color: #fff;
}

.app-nav__link--active:hover {
  color: #fff;
}
</style>

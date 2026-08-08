import ChatView from '@/views/ChatView.vue'
import KnowledgeView from '@/views/KnowledgeView.vue'
import { createRouter, createWebHashHistory } from 'vue-router'

/**
 * Hash 模式：Electron 打包后 UI 走 `file://` / `app://`，只有 hash 路由
 * 不依赖服务端 rewrite；web 模式下 hash 也照常工作。
 */
const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'chat',
      component: ChatView,
    },
    {
      path: '/knowledge',
      name: 'knowledge',
      component: KnowledgeView,
    },
  ],
})

export default router

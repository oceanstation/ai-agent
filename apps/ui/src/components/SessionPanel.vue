<template>
  <aside :class="['session-panel', { collapsed }]">
    <button
      class="toggle-btn"
      :title="collapsed ? '展开会话面板' : '收起会话面板'"
      @click="$emit('toggle')"
    >
      <span class="toggle-icon">{{ collapsed ? '›' : '‹' }}</span>
    </button>

    <div
      v-if="!collapsed"
      class="panel-body"
    >
      <div class="panel-header">
        <span class="panel-title">会话</span>
        <div class="panel-actions">
          <button
            class="new-btn"
            :disabled="loading"
            title="新建会话"
            @click="$emit('create')"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </button>
        </div>
      </div>

      <div
        v-if="loading && sessions.length === 0"
        class="panel-empty"
      >
        加载中...
      </div>
      <div
        v-else-if="sessions.length === 0"
        class="panel-empty"
      >
        暂无会话，点击"新建"开始
      </div>

      <ul class="session-list">
        <li
          v-for="s in sessions"
          :key="s.id"
          :class="['session-item', { active: s.id === currentId }]"
          :title="s.title || s.id"
          @click="$emit('select', s.id)"
        >
          <div class="session-info">
            <div class="session-title">
              {{ s.title || '(未命名会话)' }}
            </div>
            <div class="session-time">
              {{ formatRelativeTime(s.updatedAt) }}
            </div>
          </div>
          <button
            class="delete-btn"
            title="删除会话"
            @click.stop="$emit('delete', s.id)"
          >
            ×
          </button>
        </li>
      </ul>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { formatRelativeTime } from '@/utils/time';

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

defineProps<{
  sessions: SessionSummary[];
  currentId: string | null;
  collapsed: boolean;
  loading?: boolean;
}>();

defineEmits<{
  (e: 'toggle'): void;
  (e: 'select', id: string): void;
  (e: 'create'): void;
  (e: 'delete', id: string): void;
}>();
</script>

<style scoped>
.session-panel {
  position: relative;
  width: 200px;
  min-width: 200px;
  height: 100%;
  background: #ffffff;
  border-right: 1px solid #ececec;
  display: flex;
  flex-direction: column;
  transition: width 0.2s ease, min-width 0.2s ease;
  /* 不能 overflow:hidden，否则外置的 toggle 按钮会被裁切 */
}

.session-panel.collapsed {
  width: 0;
  min-width: 0;
  border-right: 1px solid #ececec;
}

.toggle-btn {
  position: absolute;
  top: 12px;
  right: -20px;
  width: 20px;
  height: 32px;
  padding: 0;
  background: #f6f6f6;
  border: 1px solid #ececec;
  border-left: none;
  border-radius: 0 6px 6px 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 5;
  color: #666;
}

.toggle-btn:hover {
  background: #eee;
  color: var(--brand-700);
}

.toggle-icon {
  font-size: 16px;
  line-height: 1;
}

.panel-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 12px;
  overflow: hidden;
  min-height: 0;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.panel-title {
  font-size: 14px;
  font-weight: 600;
  color: #333;
}

.new-btn {
  width: 22px;
  height: 22px;
  padding: 0;
  font-size: 20px;
  line-height: 1;
  border-radius: 50%;
  border: none;
  color: var(--brand-600);
  background: transparent;
  cursor: pointer;
  transition: color 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.new-btn:hover:not(:disabled) {
  color: #fff;
  background: var(--brand-600);
}

.new-btn:disabled {
  color: #ccc;
  cursor: not-allowed;
}

.panel-empty {
  color: #999;
  font-size: 12px;
  text-align: center;
  padding: 20px 0;
}

.session-list {
  list-style: none;
  padding: 0;
  margin: 0 -10px;
  overflow-y: auto;
  flex: 1;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 4px;
  transition: background 0.15s;
}

.session-item:hover {
  background: var(--brand-50-soft);
}

.session-item.active {
  background: var(--brand-100);
}

.session-info {
  flex: 1;
  min-width: 0;
}

.session-title {
  font-size: 13px;
  color: #333;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-time {
  font-size: 11px;
  color: #999;
  margin-top: 2px;
}

.delete-btn {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #aaa;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s;
}

.session-item:hover .delete-btn {
  opacity: 1;
}

.delete-btn:hover {
  background: #ffe8e8;
  color: #e53935;
}
</style>

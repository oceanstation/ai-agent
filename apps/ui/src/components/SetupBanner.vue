<template>
  <div
    v-if="visible"
    class="setup-banner"
    role="alert"
  >
    <div class="setup-banner__icon" aria-hidden="true">⚙️</div>
    <div class="setup-banner__body">
      <div class="setup-banner__title">首次设置：请填写 LLM API Key</div>
      <div class="setup-banner__hint">
        应用已把配置模板放在你的数据目录里。请打开
        <code>.env</code> 补上
        <code>LLM_FAST_API_KEY</code>
        （以及可选的 <code>CHROMA_API_KEY</code>、<code>TAVILY_API_KEY</code>），
        保存后点"重启应用"。
      </div>
    </div>
    <div class="setup-banner__actions">
      <button
        class="setup-banner__btn setup-banner__btn--primary"
        :disabled="opening"
        @click="onOpen"
      >
        {{ opening ? '打开中…' : '打开数据目录' }}
      </button>
      <button
        class="setup-banner__btn"
        :disabled="reloading"
        @click="onReload"
      >
        {{ reloading ? '重启中…' : '重启应用' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

/**
 * 桌面模式下的"首次设置"横幅。
 *
 * 触发条件（由父组件传入 `visible`）：
 *   - 挂载时探测 `/agent/health`，`llmReady=false`；
 *   - **且** `window.__IS_DESKTOP__=true`（web 部署走反向代理不看这个）。
 *
 * 两个按钮：
 *   - 打开数据目录：Finder 打开 userData，用户在里面找到并编辑 `.env`；
 *   - 重启应用：让 main 进程 kill utility agent + 重开窗口，
 *     `LlmService` 会重新读 `.env`（`get()` 只在无 cache 时读一次 API key）。
 */
interface Props {
  /** 是否显示 —— 由父组件根据 health 探测结果决定 */
  visible: boolean;
}
defineProps<Props>();

const opening = ref(false);
const reloading = ref(false);

const desktopApi = computed(() => window.__DESKTOP_API__);

async function onOpen() {
  if (!desktopApi.value) return;
  opening.value = true;
  try {
    const result = await desktopApi.value.openDataDir();
    if (result.error) {
      console.error('openDataDir error:', result.error);
    }
  } finally {
    opening.value = false;
  }
}

async function onReload() {
  if (!desktopApi.value) return;
  reloading.value = true;
  try {
    await desktopApi.value.reloadApp();
    // main 会重开新窗口，本窗口即将被关闭，无需继续处理
  } catch (err) {
    console.error('reloadApp error:', err);
    reloading.value = false;
  }
}
</script>

<style scoped>
.setup-banner {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 12px 16px 0;
  padding: 12px 16px;
  background: #fff7e6;
  border: 1px solid #ffd591;
  border-radius: 8px;
  font-size: 13px;
  color: #333;
}

.setup-banner__icon {
  font-size: 22px;
  line-height: 1;
}

.setup-banner__body {
  flex: 1;
  min-width: 0;
}

.setup-banner__title {
  font-weight: 600;
  color: #d46b08;
  margin-bottom: 4px;
}

.setup-banner__hint {
  color: #555;
  line-height: 1.55;
}

.setup-banner__hint code {
  padding: 1px 5px;
  background: #f3ece0;
  border-radius: 3px;
  font-family: SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

.setup-banner__actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.setup-banner__btn {
  padding: 6px 12px;
  border: 1px solid #d0d0d0;
  background: #fff;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
}

.setup-banner__btn:hover:not(:disabled) {
  background: #f5f5f5;
}

.setup-banner__btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.setup-banner__btn--primary {
  background: #fa8c16;
  border-color: #fa8c16;
  color: #fff;
}

.setup-banner__btn--primary:hover:not(:disabled) {
  background: #d46b08;
  border-color: #d46b08;
}
</style>

<template>
  <div
    class="spec-gate"
    :class="`spec-gate--${phase}`"
  >
    <header class="spec-gate__header">
      <span class="spec-gate__badge">SDD · {{ phase }}</span>
      <span class="spec-gate__feature">feature：{{ featureId }}</span>
    </header>

    <ol class="spec-gate__timeline">
      <li
        v-for="(item, idx) in timelineItems"
        :key="item.phase"
        class="spec-gate__step"
        :class="[`spec-gate__step--${item.status}`, item.phase === phase ? 'spec-gate__step--current' : '']"
      >
        <span class="spec-gate__step-index">{{ idx + 1 }}</span>
        <span class="spec-gate__step-body">
          <span class="spec-gate__step-name">{{ item.phase }}</span>
          <span class="spec-gate__step-status">{{ statusLabel(item.status, item.phase) }}</span>
        </span>
      </li>
    </ol>

    <div class="spec-gate__body">
      <p class="spec-gate__title">
        {{ pendingApproval ? '阶段产物已生成，待审阅' : '实施完成' }}
      </p>
      <p class="spec-gate__path">
        <span class="spec-gate__label">文件</span>
        <button
          type="button"
          class="spec-gate__link"
          :disabled="previewLoading"
          @click="togglePreview"
        >
          <code>.specify/{{ path }}</code>
        </button>
      </p>
      <p
        v-if="pendingApproval"
        class="spec-gate__hint"
      >
        请在项目中审阅该文件，通过后点击下方按钮进入下一阶段。
      </p>
      <div
        v-if="previewOpen"
        class="spec-gate__preview"
      >
        <header class="spec-gate__preview-head">
          <span>产物预览</span>
          <button
            type="button"
            class="spec-gate__preview-close"
            aria-label="关闭预览"
            @click="previewOpen = false"
          >×</button>
        </header>
        <div class="spec-gate__preview-body">
          <span
            v-if="previewLoading"
            class="spec-gate__preview-msg"
          >加载中...</span>
          <span
            v-else-if="previewError"
            class="spec-gate__preview-msg spec-gate__preview-msg--error"
          >{{ previewError }}</span>
          <MarkdownBlock
            v-else-if="previewContent"
            :content="previewContent"
          />
        </div>
      </div>
    </div>

    <footer
      v-if="pendingApproval"
      class="spec-gate__actions"
    >
      <button
        class="spec-gate__button"
        :disabled="approving || approved"
        @click="onApprove"
      >
        {{ approved ? '已批准' : approving ? '批准中...' : '批准并进入下一阶段' }}
      </button>
      <span
        v-if="error"
        class="spec-gate__error"
      >{{ error }}</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import MarkdownBlock from '@/components/MarkdownBlock.vue';
import { approveSddPhase, fetchSddArtifact } from '@/api';
import type { SpecGatePhase, SpecGatePhaseStatus } from '@ai-agent/common';
import { computed, ref } from 'vue';

const props = defineProps<{
  featureId: string;
  phase: SpecGatePhase;
  path: string;
  pendingApproval: boolean;
  timeline: Record<SpecGatePhase, SpecGatePhaseStatus>;
}>();

const emit = defineEmits<{
  approved: [{ featureId: string; phase: SpecGatePhase }];
}>();

const approving = ref(false);
const approved = ref(false);
const error = ref('');

const previewOpen = ref(false);
const previewLoading = ref(false);
const previewError = ref('');
const previewContent = ref('');

/**
 * 点击文件路径：展开/收起产物预览。
 * 首次打开时按需拉取内容并缓存，避免重复请求；后续切回同一 phase 直接复用。
 */
const togglePreview = async () => {
  if (previewOpen.value) {
    previewOpen.value = false;
    return;
  }
  previewOpen.value = true;
  if (previewContent.value || previewLoading.value) return;
  previewLoading.value = true;
  previewError.value = '';
  try {
    const data = await fetchSddArtifact(props.featureId, props.phase);
    previewContent.value = data.content ?? '';
  } catch (err) {
    previewError.value = (err as Error).message || '加载失败';
  } finally {
    previewLoading.value = false;
  }
};

const PHASE_ORDER: SpecGatePhase[] = ['specify', 'plan', 'tasks', 'implement'];

/** 时间线渲染项：叠加"用户已批准"的乐观态，让点击批准后立即变绿 */
const timelineItems = computed(() => {
  return PHASE_ORDER.map((p) => {
    let status = props.timeline?.[p] ?? 'idle';
    // 批准成功后：当前阶段乐观置为 approved
    if (approved.value && p === props.phase && status === 'pending') {
      status = 'approved';
    }
    // implement 是终态：写入即视为"完成"，视觉上与 approved 一致
    if (p === 'implement' && status === 'pending') {
      status = 'approved';
    }
    return { phase: p, status };
  });
});

const statusLabel = (
  status: SpecGatePhaseStatus,
  phase: SpecGatePhase,
): string => {
  if (status === 'approved') return phase === 'implement' ? '已完成' : '已批准';
  if (status === 'pending') return '待批准';
  if (status === 'current') return '进行中';
  return '未开始';
};

const onApprove = async () => {
  if (approving.value || approved.value) return;
  approving.value = true;
  error.value = '';
  try {
    await approveSddPhase(props.featureId, props.phase);
    approved.value = true;
    // 通知父组件：批准已落库，可以触发下一轮 agent 继续推进
    emit('approved', { featureId: props.featureId, phase: props.phase });
  } catch (err) {
    error.value = (err as Error).message || '批准失败';
  } finally {
    approving.value = false;
  }
};
</script>

<style scoped>
.spec-gate {
  border: 1px solid #d0d7de;
  border-left: 4px solid var(--brand-600, #4c6ef5);
  border-radius: 10px;
  padding: 12px 14px;
  background: #fff;
  width: 490px;
  font-size: 13px;
  line-height: 1.6;
  box-sizing: border-box;
}

.spec-gate--implement {
  border-left-color: #2f9e44;
}

.spec-gate__header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.spec-gate__badge {
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(76, 110, 245, 0.12);
  color: var(--brand-700, #364fc7);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.spec-gate--implement .spec-gate__badge {
  background: rgba(47, 158, 68, 0.12);
  color: #2b8a3e;
}

.spec-gate__feature {
  color: #57606a;
  font-size: 12px;
}

/* 4 步时间线：横向连点样式 */
.spec-gate__timeline {
  list-style: none;
  padding: 0;
  margin: 4px 0 10px 0;
  display: flex;
  gap: 4px;
}

.spec-gate__step {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid #e6e8eb;
  background: #f6f8fa;
  min-width: 0;
}

.spec-gate__step-index {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #d0d7de;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
}

.spec-gate__step-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  line-height: 1.2;
}

.spec-gate__step-name {
  font-size: 12px;
  font-weight: 600;
  color: #24292f;
  text-transform: capitalize;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.spec-gate__step-status {
  font-size: 10px;
  color: #6e7781;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 状态色 —— approved：绿；pending / current：蓝；idle：灰 */
.spec-gate__step--approved {
  background: rgba(47, 158, 68, 0.08);
  border-color: rgba(47, 158, 68, 0.3);
}
.spec-gate__step--approved .spec-gate__step-index {
  background: #2f9e44;
}
.spec-gate__step--approved .spec-gate__step-status {
  color: #2b8a3e;
}

.spec-gate__step--pending {
  background: rgba(76, 110, 245, 0.06);
  border-color: rgba(76, 110, 245, 0.3);
}
.spec-gate__step--pending .spec-gate__step-index {
  background: var(--brand-600, #4c6ef5);
}
.spec-gate__step--pending .spec-gate__step-status {
  color: var(--brand-700, #364fc7);
}

.spec-gate__step--current {
  box-shadow: 0 0 0 2px rgba(76, 110, 245, 0.2);
}

.spec-gate__body {
  margin: 0;
}

.spec-gate__title {
  margin: 0 0 6px 0;
  font-weight: 600;
  color: #1f2328;
}

.spec-gate__path {
  margin: 0 0 6px 0;
  color: #24292f;
}

.spec-gate__label {
  color: #6e7781;
  margin-right: 6px;
}

.spec-gate__link {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: inherit;
  font: inherit;
  text-align: left;
}

.spec-gate__link code {
  color: var(--brand-700, #364fc7);
  text-decoration: underline;
  text-decoration-color: rgba(76, 110, 245, 0.35);
  text-underline-offset: 2px;
  transition: color 0.15s, text-decoration-color 0.15s;
}

.spec-gate__link:hover code {
  color: var(--brand-600, #4c6ef5);
  text-decoration-color: var(--brand-600, #4c6ef5);
}

.spec-gate__link:disabled {
  cursor: wait;
  opacity: 0.7;
}

/* 产物预览：扁平容器，无阴影 */
.spec-gate__preview {
  margin-top: 8px;
  border: 1px solid #e6e8eb;
  border-radius: 6px;
  background: #fff;
  overflow: hidden;
}

.spec-gate__preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  font-size: 12px;
  color: #57606a;
  background: #f6f8fa;
  border-bottom: 1px solid #eaecef;
}

.spec-gate__preview-close {
  border: none;
  background: none;
  cursor: pointer;
  color: #6e7781;
  font-size: 16px;
  line-height: 1;
  padding: 0 4px;
  border-radius: 3px;
}

.spec-gate__preview-close:hover {
  background: #e1e4e8;
  color: #24292f;
}

.spec-gate__preview-body {
  padding: 10px 14px;
  max-height: 420px;
  overflow-y: auto;
  font-size: 13px;
  line-height: 1.6;
  color: #24292f;
}

.spec-gate__preview-msg {
  color: #6e7781;
  font-size: 12px;
}

.spec-gate__preview-msg--error {
  color: #c92a2a;
}

.spec-gate__hint {
  margin: 0;
  color: #6e7781;
  font-size: 12px;
}

.spec-gate__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}

.spec-gate__button {
  padding: 6px 14px;
  border-radius: 6px;
  border: none;
  background: var(--brand-600, #4c6ef5);
  color: #fff;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.2s;
}

.spec-gate__button:hover:not(:disabled) {
  background: var(--brand-700, #364fc7);
}

.spec-gate__button:disabled {
  background: #d0d7de;
  color: #6e7781;
  cursor: not-allowed;
}

.spec-gate__error {
  color: #c92a2a;
  font-size: 12px;
}
</style>

<template>
  <div class="kb-layout">
    <div class="kb-container">
      <header class="kb-header">
        <h1 class="kb-title">知识库检索</h1>
        <p class="kb-subtitle">
          基于本地向量数据库（Chroma + bge 中文嵌入），对已入库的语料做语义相似度检索。
        </p>
      </header>

      <div class="kb-searchbar">
        <input
          v-model="query"
          type="text"
          class="kb-input"
          :placeholder="'输入检索关键词，例如：鱼香肉丝怎么做'"
          :disabled="loading"
          @keydown.enter.prevent="handleSearch"
        />
        <div class="kb-topk">
          <label for="kb-n">TopK</label>
          <input
            id="kb-n"
            v-model.number="topK"
            type="number"
            min="1"
            max="20"
            class="kb-topk-input"
            :disabled="loading"
          />
        </div>
        <button
          class="kb-search-btn"
          :disabled="!canSearch"
          @click="handleSearch"
        >
          {{ loading ? '检索中...' : '检索' }}
        </button>
      </div>

      <div class="kb-meta">
        <span v-if="lastQuery">
          "<em>{{ lastQuery }}"</em>&nbsp;·&nbsp;命中 {{ hits.length }} 条
        </span>
        <span
          v-if="error"
          class="kb-error"
        >{{ error }}</span>
      </div>

      <div class="kb-results">
        <div
          v-if="!hits.length && !loading && lastQuery && !error"
          class="kb-empty"
        >
          未命中任何片段，试试更换关键词或降低要求。
        </div>

        <article
          v-for="hit in hits"
          :key="hit.rank"
          class="kb-card"
        >
          <header class="kb-card__head">
            <span class="kb-card__rank">#{{ hit.rank }}</span>
            <span
              v-if="hit.metadata?.heading"
              class="kb-card__heading"
            >{{ hit.metadata.heading }}</span>
            <span
              v-if="hit.metadata?.source"
              class="kb-card__source"
              :title="String(hit.metadata.source)"
            >{{ hit.metadata.source }}</span>
            <span
              v-if="hit.distance !== null"
              class="kb-card__distance"
              title="距离越小越相似（bge 归一化后 ≈ 1 - cosine）"
            >distance {{ hit.distance.toFixed(4) }}</span>
          </header>
          <MarkdownBlock
            class="kb-card__body"
            :content="hit.document"
          />
        </article>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import MarkdownBlock from '@/components/MarkdownBlock.vue';
import { ApiError, queryKnowledge, type KnowledgeHit } from '@/api';
import { computed, ref } from 'vue';

const KB_MIN_QUERY_LENGTH = 2;

const query = ref('');
const topK = ref(3);
const loading = ref(false);
const hits = ref<KnowledgeHit[]>([]);
const lastQuery = ref('');
const error = ref('');

const canSearch = computed(() => {
  if (loading.value) return false;
  const q = query.value.trim();
  if (q.length < KB_MIN_QUERY_LENGTH) return false;
  const n = Number(topK.value);
  if (!Number.isFinite(n) || n < 1 || n > 20) return false;
  return true;
});

const handleSearch = async () => {
  const q = query.value.trim();
  if (q.length < KB_MIN_QUERY_LENGTH) {
    error.value = `请至少输入 ${KB_MIN_QUERY_LENGTH} 个字。`;
    return;
  }

  loading.value = true;
  error.value = '';
  try {
    const result = await queryKnowledge(q, topK.value);
    hits.value = result.hits;
    lastQuery.value = result.query;
  } catch (err) {
    hits.value = [];
    lastQuery.value = q;
    if (err instanceof ApiError) {
      error.value = `检索失败：HTTP ${err.status}${err.message ? ' · ' + err.message : ''}`;
    } else {
      error.value = '检索失败，请稍后重试。';
    }
    console.error('knowledge query error:', err);
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped>
.kb-layout {
  height: 100vh;
  width: 100%;
  overflow: hidden;
  box-sizing: border-box;
  background: #f6f6f6;
}

.kb-container {
  height: 100%;
  max-width: 960px;
  margin: 0 auto;
  padding: 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-sizing: border-box;
}

.kb-header {
  flex-shrink: 0;
}

.kb-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #1f2328;
}

.kb-subtitle {
  margin: 4px 0 0;
  font-size: 12px;
  color: #57606a;
}

.kb-searchbar {
  flex-shrink: 0;
  display: flex;
  gap: 8px;
  align-items: center;
  background: #fff;
  border: 1px solid #e8e8e8;
  border-radius: 10px;
  padding: 8px;
}

.kb-input {
  flex: 1;
  height: 32px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  background: #f6f8fa;
  color: #1f2328;
  transition: border-color 0.15s, background 0.15s;
}

.kb-input:focus {
  border-color: var(--brand-600);
  background: #fff;
}

.kb-input:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.kb-topk {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #57606a;
}

.kb-topk-input {
  width: 56px;
  height: 32px;
  padding: 0 8px;
  border: 1px solid #e8e8e8;
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  text-align: center;
}

.kb-topk-input:focus {
  border-color: var(--brand-600);
}

.kb-search-btn {
  height: 32px;
  padding: 0 16px;
  border-radius: 6px;
  border: none;
  background: var(--brand-600);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s, transform 0.15s;
}

.kb-search-btn:hover:not(:disabled) {
  background: var(--brand-700);
}

.kb-search-btn:disabled {
  background: #d0d7de;
  cursor: not-allowed;
}

.kb-meta {
  flex-shrink: 0;
  font-size: 12px;
  color: #57606a;
  display: flex;
  gap: 12px;
  align-items: center;
  min-height: 16px;
}

.kb-meta em {
  color: #1f2328;
  font-style: normal;
  font-weight: 600;
}

.kb-error {
  color: #d63384;
}

.kb-results {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 4px;
}

.kb-empty {
  padding: 24px;
  text-align: center;
  color: #8c959f;
  font-size: 13px;
  background: #fff;
  border-radius: 8px;
}

.kb-card {
  background: #fff;
  border-radius: 10px;
  padding: 12px 16px;
  border: 1px solid #eef0f2;
  transition: border-color 0.15s;
}

.kb-card:hover {
  border-color: #d0d7de;
}

.kb-card__head {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: #57606a;
  padding-bottom: 8px;
  border-bottom: 1px dashed #eaecef;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.kb-card__rank {
  color: var(--brand-600);
  font-weight: 700;
  font-size: 12px;
}

.kb-card__heading {
  font-weight: 600;
  color: #1f2328;
  font-size: 13px;
}

.kb-card__source {
  color: #8c959f;
  font-size: 11px;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kb-card__distance {
  margin-left: auto;
  font-family:
    'JetBrains Mono', 'Fira Code', 'Menlo', 'Monaco', 'Consolas', monospace;
  color: #8c959f;
  font-size: 11px;
}

.kb-card__body {
  font-size: 13px;
  color: #24292f;
}
</style>

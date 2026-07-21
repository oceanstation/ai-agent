<template>
  <div
    class="markdown"
    @dblclick="copyContent($event)"
    v-html="renderedContent"
  />
</template>

<script setup lang="ts">
import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'
import { fromHighlighter } from '@shikijs/markdown-it/core'
import { createHighlighterCore } from 'shiki/core'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'
import { computed, ref, onMounted } from 'vue'

const props = defineProps<{
  content: string
}>()

const md = ref<MarkdownIt | null>(null)

onMounted(async () => {
  const highlighter = await createHighlighterCore({
    themes: [
      import('shiki/themes/github-dark.mjs'),
      import('shiki/themes/github-light.mjs'),
    ],
    langs: [
      import('shiki/langs/javascript.mjs'),
      import('shiki/langs/typescript.mjs'),
      import('shiki/langs/python.mjs'),
      import('shiki/langs/json.mjs'),
      import('shiki/langs/html.mjs'),
      import('shiki/langs/css.mjs'),
      import('shiki/langs/shell.mjs'),
      import('shiki/langs/markdown.mjs'),
      import('shiki/langs/yaml.mjs'),
      import('shiki/langs/sql.mjs'),
    ],
    engine: createOnigurumaEngine(import('shiki/wasm')),
  })

  const instance = MarkdownIt({ html: true, linkify: true, typographer: true })
  instance.use(
    fromHighlighter(highlighter, {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
    })
  )
  md.value = instance
})

const renderedContent = computed(() => {
  if (!md.value) {
    // shiki 尚未加载完成，使用纯 markdown-it 降级渲染
    const fallback = MarkdownIt({ html: true, linkify: true, typographer: true })
    const rawHtml = fallback.render(props.content)
    return DOMPurify.sanitize(rawHtml)
  }
  const rawHtml = md.value.render(props.content)
  return DOMPurify.sanitize(rawHtml)
})

const copyContent = async (event: MouseEvent) => {
  const text = (event.target as HTMLElement).textContent || ''
  try {
    await navigator.clipboard.writeText(text)
  } catch (err) {
    console.error('复制失败:', err)
  }
}
</script>

<style scoped>
.markdown {
  background: #fff;
  padding: 3px 10px;
  font-size: 13px;
  border-radius: 12px 12px 0 12px;
  position: relative;
  line-height: 1.6;
}

:deep(ul) {
  padding-inline-start: 15px;
}

:deep(ol) {
  padding-inline-start: 15px;
}

/* 代码块样式 */
:deep(pre) {
  border-radius: 8px;
  padding: 12px 16px;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.5;
  margin: 8px 0;
}

:deep(pre code) {
  font-family: 'JetBrains Mono', 'Fira Code', 'Menlo', 'Monaco', 'Consolas', monospace;
}

/* 行内代码 */
:deep(:not(pre) > code) {
  background: #f3f4f6;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
  font-family: 'JetBrains Mono', 'Fira Code', 'Menlo', 'Monaco', 'Consolas', monospace;
  color: #d63384;
}

/* shiki 双主题支持 - 默认亮色 */
:deep(.shiki) {
  background-color: var(--shiki-light-bg, #fff) !important;
}

:deep(.shiki span) {
  color: var(--shiki-light, inherit);
}
</style>

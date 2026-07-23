/**
 * 知识库/历史检索命中结果的展示层公共方法。
 *
 * 复用场景：
 * - 会话内 FTS5 检索命中回显（ChatView 的知识库分支）。
 * - 未来可能新增的"全局历史搜索"面板。
 *
 * 设计原则：
 * - 纯函数，无副作用；输入 hits + query，输出 markdown 字符串。
 * - 与后端 `HistorySearchHit` 结构解耦：只依赖最小字段集 `HistorySearchHitLike`，
 *   任何提供相同字段的数据源都能复用。
 * - 输出的 markdown 会被 `MarkdownBlock` 走 `markdown-it (html:true)` + DOMPurify 渲染，
 *   因此这里显式对完整内容做 HTML 转义 + 关键词高亮，避免原文里的 `<`、`>`
 *   被误当成 HTML 解析，也避免破坏 `<details>` 块结构。
 */

/** 命中项在展示层需要的最小字段集 */
export interface HistorySearchHitLike {
  /** 消息角色：user / assistant / tool / system */
  role: string;
  /** 写入时间（unix ms） */
  createdAt: number;
  /** 服务端已用 <mark> 高亮好的短摘要（12 token 左右） */
  snippet: string;
  /** 消息的完整原文（未高亮） */
  content: string;
}

/** 格式化选项 */
export interface FormatSearchHitsOptions {
  /** 单条完整预览的最大字符数，超出会被截断并追加提示；默认 600 */
  fullPreviewMax?: number;
  /** 未命中时的提示文案；默认给出通用中文提示 */
  emptyText?: (query: string) => string;
  /** 命中数不为 0 时的顶部前缀；默认 "🔎 知识库命中 N 条：" */
  header?: (count: number) => string;
}

const DEFAULT_FULL_PREVIEW_MAX = 600;

/** 转义正则的元字符，供构造关键词高亮的动态正则用 */
const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 把用户输入的 FTS5 query 拆成纯文本关键词。
 * - 支持空格 / 中英文引号分隔，过滤空 token。
 * - 只用于前端本地高亮，不参与后端 MATCH 表达式。
 */
export const extractHighlightTerms = (query: string): string[] =>
  query
    .split(/[\s"'“”‘’]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

/**
 * 对纯文本做 HTML 转义。
 * 用于在 v-html 渲染前保护 `<`、`>`、`&` 等特殊字符，防止原文被误解析成 HTML。
 */
export const escapeHtml = (raw: string): string =>
  raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * 对已 HTML 转义后的文本做关键词高亮：
 * 用 `<mark>...</mark>` 包裹每一个匹配项（不区分大小写）。
 *
 * 注意：必须在 `escapeHtml` 之后调用，否则关键词里包含 `<` 时会破坏渲染。
 */
export const highlightKeywords = (
  escapedText: string,
  terms: string[],
): string => {
  if (!terms.length) return escapedText;
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  return escapedText.replace(pattern, '<mark>$1</mark>');
};

/**
 * 将完整原文转成"可安全放入 markdown 的 HTML 片段"：
 * 1) 先按 fullPreviewMax 截断；
 * 2) HTML 转义；
 * 3) 关键词高亮；
 * 4) 用 `<pre class="kb-full">` 包裹，保留换行同时避免 markdown 解析 blockquote/details 的边界问题。
 */
export const renderFullContentHtml = (
  content: string,
  terms: string[],
  fullPreviewMax: number = DEFAULT_FULL_PREVIEW_MAX,
): string => {
  const raw = content ?? '';
  const truncated =
    raw.length > fullPreviewMax
      ? `${raw.slice(0, fullPreviewMax)}…（共 ${raw.length} 字，已截断）`
      : raw;
  const highlighted = highlightKeywords(escapeHtml(truncated), terms);
  return `<pre class="kb-full">${highlighted}</pre>`;
};

/**
 * 把一批命中格式化成 markdown 字符串，供 `MarkdownBlock` 渲染。
 *
 * 输出结构（每条命中）：
 *   **{idx}. [{role}] · {time}**
 *
 *   > {snippet(带mark)}
 *
 *   <details><summary>查看完整记录</summary>
 *     <pre class="kb-full">...完整内容(带mark)...</pre>
 *   </details>
 *
 * 条目之间用 `---` 分隔。命中为空时返回 `emptyText(query)`。
 */
export const formatSearchHits = (
  hits: HistorySearchHitLike[],
  query: string,
  options: FormatSearchHitsOptions = {},
): string => {
  const {
    fullPreviewMax = DEFAULT_FULL_PREVIEW_MAX,
    emptyText = (q) => `未在当前会话知识库中命中「${q}」。`,
    header = (n) => `🔎 知识库命中 ${n} 条：`,
  } = options;

  if (!hits.length) return emptyText(query);

  const terms = extractHighlightTerms(query);
  const lines = hits.map((hit, idx) => {
    const time = new Date(hit.createdAt).toLocaleString();
    const fullHtml = renderFullContentHtml(hit.content, terms, fullPreviewMax);
    return [
      `**${idx + 1}. [${hit.role}] · ${time}**`,
      '',
      `> ${hit.snippet}`,
      '',
      '<details><summary>查看完整记录</summary>',
      '',
      fullHtml,
      '',
      '</details>',
    ].join('\n');
  });

  return `${header(hits.length)}\n\n${lines.join('\n\n---\n\n')}`;
};

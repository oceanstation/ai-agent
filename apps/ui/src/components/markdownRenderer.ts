import MarkdownIt from 'markdown-it';

/**
 * 模块级单例：整个应用生命周期只 new 一次，被所有 MarkdownBlock 实例共享。
 */
export const md = MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
});

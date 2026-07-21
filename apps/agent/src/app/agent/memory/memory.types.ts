/**
 * Memory 子系统的公共类型定义。
 *
 * 设计遵循两层记忆：
 * - Evergreen（常青记忆）：MEMORY.md，长期有效、手动维护，不受时间衰减影响
 * - Daily（每日日志）：memory/YYYY-MM-DD.md，由 Memory Flush 机制自动追加
 */

/** 拼装进 system prompt 的记忆上下文快照 */
export interface MemoryContext {
  /** MEMORY.md 全文；不存在时为空串 */
  evergreen: string;
  /** 最近 N 天日志聚合文本；不存在时为空串 */
  recentDaily: string;
}

/** 一条对话消息在 Memory 视角下的最小结构 */
export interface MemoryMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
}

/** Memory Flush 的输入 */
export interface FlushInput {
  /** 会话 ID，可用于日志中标记来源；本地单用户场景可省略 */
  sessionId?: string;
  /** 参与本次总结的对话消息 */
  messages: MemoryMessage[];
}

/** Memory Flush 的结果 */
export interface FlushResult {
  /** 是否真的写入（若判定无值得记忆的信息则为 false） */
  written: boolean;
  /** 写入的目标文件绝对路径 */
  file: string;
  /** 追加的摘要文本（供日志/调试） */
  summary: string;
}

/** 记忆写入的作用域 */
export type MemoryScope = 'evergreen' | 'daily';

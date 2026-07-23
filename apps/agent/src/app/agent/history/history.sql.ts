/**
 * HistoryService 使用的所有 SQL 模板集中管理。
 *
 * 约定：
 * - 所有语句使用 `?` 占位符，参数由调用方按顺序绑定，禁止字符串拼接。
 * - DDL 与 DML 分离：`SCHEMA_SQL` 只在 `onModuleInit` 执行一次。
 * - 常量对象加 `as const`，避免误改；便于 IDE 查找引用。
 */

/** 建表 / 索引：启动时一次性 exec，幂等 */
export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    tool_name  TEXT,
    raw        TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session
    ON messages(session_id, id);

  CREATE INDEX IF NOT EXISTS idx_sessions_updated_at
    ON sessions(updated_at DESC);
`;

/**
 * FTS5 全文检索 schema：影子索引 messages_fts + 3 个触发器。
 *
 * 设计说明：
 * - `content='messages' / content_rowid='id'`：外部内容表模式，FTS 表只维护
 *   倒排索引，正文仍由 messages 表持有，避免双写与数据漂移。
 * - `tokenize='trigram'`：SQLite 3.34+ 内置的三元组分词器，对中文短语检索友好
 *   （unicode61 会退化为逐字，噪声大）。
 * - 三个触发器分别对应 INSERT / DELETE / UPDATE，保证 messages 变更自动同步到 FTS。
 *   DELETE / UPDATE 的写法 `INSERT INTO messages_fts(messages_fts, ...) VALUES('delete', ...)`
 *   是 FTS5 官方推荐的"外部内容表"同步范式。
 */
export const FTS_SCHEMA_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content,
    content='messages',
    content_rowid='id',
    tokenize='trigram'
  );

  CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
  END;

  CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content)
      VALUES('delete', old.id, old.content);
  END;

  CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content)
      VALUES('delete', old.id, old.content);
    INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
  END;
`;

/** 启动时执行的 PRAGMA 语句 */
export const PRAGMA_SQL = {
  /** 开启外键约束，删除 session 时级联清理 messages */
  foreignKeysOn: 'PRAGMA foreign_keys = ON;',
  /** WAL 提升并发读写吞吐；单用户场景收益小但无害 */
  journalModeWal: 'PRAGMA journal_mode = WAL;',
} as const;

/** sessions 表相关 SQL */
export const SESSION_SQL = {
  /** 参数顺序: id, title, created_at, updated_at */
  insert:
    'INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',

  /** 参数顺序: id */
  existsById: 'SELECT 1 AS ok FROM sessions WHERE id = ?',

  /** 参数顺序: limit */
  listRecent:
    'SELECT id, title, created_at AS createdAt, updated_at AS updatedAt ' +
    'FROM sessions ORDER BY updated_at DESC LIMIT ?',

  /** 参数顺序: id */
  deleteById: 'DELETE FROM sessions WHERE id = ?',

  /**
   * 追加消息时同步 updated_at；若首次 user 消息则用其内容截断补 title。
   * 参数顺序: now, role, content, titleMaxLength, sessionId
   */
  touchAndMaybeSetTitle: `
    UPDATE sessions
       SET updated_at = ?,
           title = CASE
             WHEN (title IS NULL OR title = '') AND ? = 'user'
             THEN substr(?, 1, ?)
             ELSE title
           END
     WHERE id = ?
  `,
} as const;

/** messages 表相关 SQL */
export const MESSAGE_SQL = {
  /** 参数顺序: session_id, role, content, tool_name, raw, created_at */
  insert: `
    INSERT INTO messages (session_id, role, content, tool_name, raw, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `,

  /** 参数顺序: session_id */
  listBySession: `
    SELECT id, session_id AS sessionId, role, content,
           tool_name AS toolName, raw, created_at AS createdAt
      FROM messages
     WHERE session_id = ?
     ORDER BY id ASC
  `,

  /**
   * 仅在指定 session 内做 FTS5 全文检索，按 rank 相关度升序（越靠前越相关）返回。
   *
   * 说明：
   * - `snippet(表, 列索引, 开标签, 闭标签, 省略符, token数)` 返回带高亮标记的摘要片段，
   *   前端可直接以 HTML 渲染（<mark> 是 W3C 标准语义标签）。
   * - `messages_fts MATCH ?` 才会走 FTS 倒排索引；`m.session_id = ?` 是普通 B-Tree 过滤，
   *   两者组合后即"当前会话内命中的消息按相关度排序"。
   * - 参数顺序: matchQuery, sessionId, limit
   */
  searchInSession: `
    SELECT m.id, m.session_id AS sessionId, m.role, m.content,
           m.tool_name AS toolName, m.raw, m.created_at AS createdAt,
           snippet(messages_fts, 0, '<mark>', '</mark>', '…', 12) AS snippet
      FROM messages_fts
      JOIN messages m ON m.id = messages_fts.rowid
     WHERE messages_fts MATCH ?
       AND m.session_id = ?
     ORDER BY rank
     LIMIT ?
  `,
} as const;

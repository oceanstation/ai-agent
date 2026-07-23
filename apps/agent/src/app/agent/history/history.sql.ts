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
} as const;

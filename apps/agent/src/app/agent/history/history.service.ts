import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadHistoryConfig, type HistoryConfig } from './history.config';
import {
  MESSAGE_SQL,
  PRAGMA_SQL,
  SCHEMA_SQL,
  SESSION_SQL,
} from './history.sql';
import type {
  AppendMessageInput,
  HistoryMessage,
  HistorySession,
} from './history.types';

/**
 * HistoryService：基于 Node 原生 `node:sqlite` 的对话历史存储。
 *
 * 设计要点：
 * - 单例、单连接：SQLite 本身是文件级并发，NestJS provider 天然单例，直接持有连接即可。
 * - 建库幂等：启动时执行 `CREATE TABLE IF NOT EXISTS`，无需额外迁移脚本。
 * - 预编译语句：热点 SQL（append/list/get）使用 `prepare` 缓存，避免重复解析。
 * - 失败不阻塞：任何写入异常均 warn 后吞掉，不影响主对话流程。
 *
 * 备注：`node:sqlite` 在 Node 22 需 `--experimental-sqlite` flag；
 * Node 24+ 已稳定，flag 存在也无副作用。
 */
@Injectable()
export class HistoryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HistoryService.name);
  private readonly config: HistoryConfig;
  private db: DatabaseSync | null = null;

  constructor(configService: ConfigService) {
    this.config = loadHistoryConfig(configService);
  }

  onModuleInit(): void {
    try {
      fs.mkdirSync(path.dirname(this.config.dbFile), { recursive: true });
      this.db = new DatabaseSync(this.config.dbFile);
      // 开启外键约束，删除 session 时级联清理 messages
      this.db.exec(PRAGMA_SQL.foreignKeysOn);
      // WAL 提升并发读写吞吐；单用户场景收益小但无害
      this.db.exec(PRAGMA_SQL.journalModeWal);
      this.initSchema();
      this.logger.log(`HistoryService 已连接 SQLite: ${this.config.dbFile}`);
    } catch (err) {
      this.logger.warn(
        `HistoryService 初始化失败（历史记录将不可用）: ${(err as Error).message}`,
      );
      this.db = null;
    }
  }

  onModuleDestroy(): void {
    try {
      this.db?.close();
    } catch {
      // ignore
    }
    this.db = null;
  }

  // ===================== 会话（sessions） =====================

  /**
   * 创建一个新会话；若传入 title 则直接使用，否则留空由首条消息更新。
   * 返回新建的完整 session 对象。
   */
  createSession(title = ''): HistorySession {
    const db = this.ensureDb();
    const id = randomUUID();
    const now = Date.now();
    db.prepare(SESSION_SQL.insert).run(id, title, now, now);
    return { id, title, createdAt: now, updatedAt: now };
  }

  /** 判断会话是否存在（供 controller 校验 sessionId 合法性） */
  hasSession(id: string): boolean {
    if (!this.db) return false;
    const row = this.db.prepare(SESSION_SQL.existsById).get(id);
    return !!row;
  }

  /** 列出所有会话，按最近活跃时间倒序 */
  listSessions(limit = 100): HistorySession[] {
    if (!this.db) return [];
    const rows = this.db.prepare(SESSION_SQL.listRecent).all(limit);
    return rows as unknown as HistorySession[];
  }

  /** 删除一个会话（级联删除其消息） */
  deleteSession(id: string): boolean {
    if (!this.db) return false;
    const info = this.db.prepare(SESSION_SQL.deleteById).run(id);
    return Number(info.changes) > 0;
  }

  // ===================== 消息（messages） =====================

  /**
   * 追加一条消息；同时更新所属 session 的 updated_at。
   * 若 session 尚无 title，则用首条 user 消息截断填充。
   */
  appendMessage(input: AppendMessageInput): HistoryMessage | null {
    if (!this.db) return null;
    const now = Date.now();
    try {
      const info = this.db
        .prepare(MESSAGE_SQL.insert)
        .run(
          input.sessionId,
          input.role,
          input.content,
          input.toolName ?? null,
          input.raw ?? null,
          now,
        );

      // 同步 session.updated_at；若尚未设置 title 且当前是 user 消息，则补上
      this.db
        .prepare(SESSION_SQL.touchAndMaybeSetTitle)
        .run(
          now,
          input.role,
          input.content,
          this.config.titleMaxLength,
          input.sessionId,
        );

      return {
        id: Number(info.lastInsertRowid),
        sessionId: input.sessionId,
        role: input.role,
        content: input.content,
        toolName: input.toolName ?? null,
        raw: input.raw ?? null,
        createdAt: now,
      };
    } catch (err) {
      this.logger.warn(`appendMessage 失败: ${(err as Error).message}`);
      return null;
    }
  }

  /** 读取某个 session 的全部消息，按写入顺序（id 升序）返回 */
  getMessages(sessionId: string): HistoryMessage[] {
    if (!this.db) return [];
    const rows = this.db.prepare(MESSAGE_SQL.listBySession).all(sessionId);
    return rows as unknown as HistoryMessage[];
  }

  // ===================== 内部辅助 =====================

  private ensureDb(): DatabaseSync {
    if (!this.db) {
      throw new Error('HistoryService 未初始化或初始化失败');
    }
    return this.db;
  }

  private initSchema(): void {
    if (!this.db) return;
    this.db.exec(SCHEMA_SQL);
  }
}

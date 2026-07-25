import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import matter from 'gray-matter';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { loadSkillConfig, type SkillConfig } from './skill.config';
import type { SkillMeta } from './skill.types';

/**
 * SkillService：技能（Skill）子系统的核心服务。
 *
 * 对齐 Anthropic Agent Skills 的"渐进式披露"（Progressive Disclosure）思想：
 *   1) 启动时扫描 `<root>/<skill>/SKILL.md`，解析 YAML frontmatter 只取
 *      `name` + `description` 作为轻量元数据；
 *   2) 元数据会被 system prompt 一次性列出（几十字/条），代价很小；
 *   3) 模型判断需要某个 skill 时，通过 `read_skill` 工具按名字加载 SKILL.md
 *      全文（可能上千字），把详细指令流式装入上下文。
 *
 * 所有失败路径都会 warn + 返回空/默认值，避免影响主对话。
 */
@Injectable()
export class SkillService implements OnModuleInit {
  private readonly logger = new Logger(SkillService.name);
  private readonly config: SkillConfig;

  /** 启动扫描后的 skill 元数据，按 name 索引，方便 O(1) 查询 */
  private readonly registry = new Map<string, SkillMeta>();

  constructor(configService: ConfigService) {
    this.config = loadSkillConfig(configService);
  }

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  /**
   * 重新扫描 skills 目录并刷新注册表。
   *
   * 独立方法便于将来接入"热加载"或管理端触发。
   */
  async reload(): Promise<void> {
    this.registry.clear();
    const entries = await this.safeReadDir(this.config.root);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(this.config.root, entry.name);
      const filePath = path.join(dir, 'SKILL.md');
      const meta = await this.tryLoadSkill(entry.name, dir, filePath);
      if (meta) {
        this.registry.set(meta.name, meta);
      }
    }
    this.logger.log(
      `已加载 ${this.registry.size} 个 skill：${[...this.registry.keys()].join(', ') || '（空）'}`,
    );
  }

  /** 返回所有 skill 的元数据，按名字排序稳定输出 */
  list(): SkillMeta[] {
    return [...this.registry.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  /** 列出所有 skill 名字（供工具入参 enum 校验时使用） */
  listNames(): string[] {
    return [...this.registry.keys()].sort();
  }

  /** 读取指定 skill 的 SKILL.md 全文；不存在时返回 null */
  async read(name: string): Promise<string | null> {
    const meta = this.registry.get(name);
    if (!meta) return null;
    try {
      return await fs.readFile(meta.filePath, 'utf-8');
    } catch (err) {
      this.logger.warn(
        `读取 skill ${name} 失败：${(err as Error).message}`,
      );
      return null;
    }
  }

  /** 暴露配置只读视图 */
  getConfig(): Readonly<SkillConfig> {
    return this.config;
  }

  // ===================== 私有辅助 =====================

  private async safeReadDir(dir: string): Promise<import('node:fs').Dirent[]> {
    try {
      return await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        this.logger.warn(`扫描 skills 目录失败 ${dir}: ${(err as Error).message}`);
      }
      return [];
    }
  }

  private async tryLoadSkill(
    dirName: string,
    dir: string,
    filePath: string,
  ): Promise<SkillMeta | null> {
    let raw: string;
    try {
      raw = await fs.readFile(filePath, 'utf-8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        this.logger.warn(
          `读取 SKILL.md 失败 ${filePath}: ${(err as Error).message}`,
        );
      }
      return null;
    }

    const fm = parseFrontmatter(raw);
    const name = pickString(fm['name']) ?? dirName;
    const description = pickString(fm['description']) ?? '';
    if (!description) {
      this.logger.warn(
        `Skill ${dirName} 缺少 description，已跳过（SKILL.md frontmatter 需含 name/description）`,
      );
      return null;
    }
    return { name, description, filePath, dir };
  }
}

/**
 * 使用 gray-matter 解析 SKILL.md 的 YAML frontmatter。
 * 解析失败或没有 frontmatter 时会安全地返回空对象。
 */
function parseFrontmatter(raw: string) {
  try {
    const parsed = matter(raw);
    return (parsed.data ?? {});
  } catch {
    return {};
  }
}

/** 将 frontmatter 中的任意值收窄为已 trim 的非空字符串，否则返回 undefined */
function pickString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

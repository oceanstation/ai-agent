import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { loadWorkspaceConfig, type WorkspaceConfig } from './workspace.config';

/**
 * WorkspaceError：所有越界/拒绝类错误都用它抛出
 *
 * 注：把错误分类从"字符串魔法"升级成类型级契约，
 * 让上层能像处理 HTTP status code 那样处理 workspace 错误
 */
export class WorkspaceError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_PATH'
      | 'OUT_OF_WORKSPACE'
      | 'DENIED'
      | 'SYMLINK_ESCAPE'
      | 'READ_ONLY'
      | 'FILE_TOO_LARGE'
      | 'COMMAND_DISABLED'
      | 'COMMAND_NOT_ALLOWED',
    message: string,
  ) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

/** run_command 返回结构 */
export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

/**
 * WorkspaceService：Agent 对用户文件系统的唯一入口。
 *
 * 所有文件相关工具（read_file / write_file / list_dir / run_command）
 * 都必须通过本服务解析路径，禁止直接拼 `path.join`。
 */
@Injectable()
export class WorkspaceService {
  private readonly config: WorkspaceConfig;

  constructor(configService: ConfigService) {
    this.config = loadWorkspaceConfig(configService);
  }

  getConfig(): Readonly<WorkspaceConfig> {
    return this.config;
  }

  // =====================================================================
  // 路径解析：沙箱的核心
  // =====================================================================

  /**
   * 把"用户/LLM 提供的相对路径"解析为受信的绝对路径。
   *
   * 校验层级：
   *   1. 非空 & 不含 NUL 字节
   *   2. 规范化后必须仍在 root 内（阻挡 `..` / 绝对路径）
   *   3. 命中 denyGlobs 直接拒绝
   *   4. 若目标存在：realpath 解开符号链接后再次校验（防 symlink 逃逸）
   *
   * @param userPath  相对 workspace 根的路径；也接受形如 `./foo/bar` 的形式
   * @param opts
   * @param opts.mustExist  为 true 时目标必须存在，否则抛出原生 ENOENT
   */
  async resolve(
    userPath: string,
    opts: { mustExist?: boolean } = {},
  ): Promise<string> {
    if (typeof userPath !== 'string' || userPath.length === 0) {
      throw new WorkspaceError('INVALID_PATH', '路径不能为空');
    }
    if (userPath.includes('\0')) {
      throw new WorkspaceError('INVALID_PATH', '路径包含非法 NUL 字节');
    }

    // 允许 LLM 传入绝对路径 —— 但必须落在 root 内；相对路径以 root 为基。
    const abs = path.isAbsolute(userPath)
      ? path.resolve(userPath)
      : path.resolve(this.config.root, userPath);

    if (!this.isInsideRoot(abs)) {
      throw new WorkspaceError(
        'OUT_OF_WORKSPACE',
        `路径超出 workspace：${userPath}`,
      );
    }

    const rel = this.toRelative(abs);
    if (this.matchDeny(rel)) {
      throw new WorkspaceError('DENIED', `路径命中禁区：${rel}`);
    }

    // realpath 校验：符号链接不能指向 workspace 之外
    try {
      const real = await fs.realpath(abs);
      if (!this.isInsideRoot(real)) {
        throw new WorkspaceError(
          'SYMLINK_ESCAPE',
          `符号链接指向 workspace 之外：${userPath}`,
        );
      }
      return real;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        if (opts.mustExist) throw err;
        // 目标未创建 —— 父目录也需要校验一次（防 `../evil/new.txt` 绕过）
        const parent = path.dirname(abs);
        if (parent !== abs) {
          try {
            const realParent = await fs.realpath(parent);
            if (!this.isInsideRoot(realParent)) {
              throw new WorkspaceError(
                'SYMLINK_ESCAPE',
                `父目录已越界：${userPath}`,
              );
            }
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
          }
        }
        return abs;
      }
      throw err;
    }
  }

  /** 供工具层展示：把绝对路径转成相对 workspace 根的展示路径 */
  toRelative(abs: string): string {
    const rel = path.relative(this.config.root, abs);
    return rel === '' ? '.' : rel.split(path.sep).join('/');
  }

  // =====================================================================
  // 高层辅助：让工具代码保持简洁
  // =====================================================================

  /** 断言可写；不可写时抛 READ_ONLY */
  assertWritable(): void {
    if (!this.config.writable) {
      throw new WorkspaceError(
        'READ_ONLY',
        'workspace 当前为只读模式（设置 WORKSPACE_WRITABLE=true 开启）',
      );
    }
  }

  /** 断言命令执行已启用且命令在白名单里 */
  assertCommandAllowed(cmd: string): void {
    if (!this.config.commandEnabled) {
      throw new WorkspaceError(
        'COMMAND_DISABLED',
        'workspace 未启用命令执行（设置 WORKSPACE_COMMAND_ENABLED=true 开启）',
      );
    }
    const bin = path.basename(cmd);
    if (!this.config.commandAllowlist.includes(bin)) {
      throw new WorkspaceError(
        'COMMAND_NOT_ALLOWED',
        `命令 "${bin}" 不在白名单中。当前允许：${this.config.commandAllowlist.join(', ') || '（空）'}`,
      );
    }
  }

  /** 读文本文件（带大小限制） */
  async readTextFile(absPath: string): Promise<string> {
    const stat = await fs.stat(absPath);
    if (stat.size > this.config.maxFileSize) {
      throw new WorkspaceError(
        'FILE_TOO_LARGE',
        `文件大小 ${stat.size} 字节超过上限 ${this.config.maxFileSize}`,
      );
    }
    return fs.readFile(absPath, 'utf-8');
  }

  /** 写文本文件（自动建父目录，带大小限制） */
  async writeTextFile(absPath: string, content: string): Promise<void> {
    const size = Buffer.byteLength(content, 'utf-8');
    if (size > this.config.maxFileSize) {
      throw new WorkspaceError(
        'FILE_TOO_LARGE',
        `待写入内容 ${size} 字节超过上限 ${this.config.maxFileSize}`,
      );
    }
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, content, 'utf-8');
  }

  /**
   * 执行受限命令：
   *   - shell:false，参数以数组形式传入，杜绝 shell 注入
   *   - cwd 强制在 workspace 内
   *   - 超时后 SIGKILL
   *   - stdout/stderr 超过上限时截断，避免上下文爆炸
   */
  async runCommand(
    cmd: string,
    args: string[],
    cwdRel?: string,
  ): Promise<CommandResult> {
    this.assertCommandAllowed(cmd);
    const cwd = cwdRel
      ? await this.resolve(cwdRel, { mustExist: true })
      : this.config.root;

    return new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(cmd, args, {
        cwd,
        env: {
          // 白名单式环境变量，防止敏感信息泄漏给子进程
          PATH: process.env.PATH ?? '',
          HOME: process.env.HOME ?? '',
          LANG: process.env.LANG ?? 'C.UTF-8',
        },
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];
      let stdoutSize = 0;
      let stderrSize = 0;
      let truncated = false;
      let timedOut = false;

      const limit = this.config.maxCommandOutput;

      child.stdout.setEncoding('utf-8');
      child.stderr.setEncoding('utf-8');

      child.stdout.on('data', (data: string) => {
        if (stdoutSize >= limit) {
          truncated = true;
          return;
        }
        const remain = limit - stdoutSize;
        const chunk = data.length > remain ? data.slice(0, remain) : data;
        stdoutChunks.push(chunk);
        stdoutSize += chunk.length;
        if (data.length > remain) truncated = true;
      });

      child.stderr.on('data', (data: string) => {
        if (stderrSize >= limit) {
          truncated = true;
          return;
        }
        const remain = limit - stderrSize;
        const chunk = data.length > remain ? data.slice(0, remain) : data;
        stderrChunks.push(chunk);
        stderrSize += chunk.length;
        if (data.length > remain) truncated = true;
      });

      const killer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, this.config.commandTimeoutMs);

      child.on('error', (err) => {
        clearTimeout(killer);
        reject(err);
      });

      child.on('close', (code) => {
        clearTimeout(killer);
        resolve({
          code,
          stdout: stdoutChunks.join(''),
          stderr: stderrChunks.join(''),
          timedOut,
          truncated,
        });
      });
    });
  }

  // =====================================================================
  // 私有工具
  // =====================================================================

  /** 判断 abs 是否位于 workspace 根内（含根本身） */
  private isInsideRoot(abs: string): boolean {
    const rel = path.relative(this.config.root, abs);
    if (rel === '') return true;
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  }

  /**
   * 极简 glob 匹配（只支持 `**` 与 `*`）。
   * 匹配对象：相对 workspace 根、使用 `/` 分隔的路径。
   *
   * 之所以不引第三方（minimatch / picomatch）：
   *   - 依赖越少，攻击面越小
   *   - 本地需求就是"敏感目录/后缀"，正则化足够
   */
  private matchDeny(rel: string): boolean {
    if (rel === '.' || rel === '') return false;
    return this.config.denyGlobs.some((g) => globToRegex(g).test(rel));
  }
}

/** 把极简 glob 转为 RegExp（整串锚定） */
function globToRegex(glob: string): RegExp {
  // 转义正则元字符，再把 * 和 ** 替换回通配符
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  // 注意：先处理 ** 再处理单 *，避免 `**` 被拆成两个 `.*`
  const pattern = escaped
    .replace(/\*\*/g, '::DOUBLESTAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLESTAR::/g, '.*');
  return new RegExp(`^${pattern}$`);
}

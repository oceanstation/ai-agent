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

/** 子进程 stdout/stderr 的截断缓冲；成对使用避免重复 slice/size 记账 */
interface OutputBuf {
  chunks: string[];
  size: number;
}

/**
 * WorkspaceService：Agent 对用户文件系统的唯一入口。
 *
 * 所有文件相关工具（read_file / write_file / list_dir / run_command）
 * 都必须通过本服务解析路径，禁止直接拼 `path.join`。
 */
@Injectable()
export class WorkspaceService {
  private config: WorkspaceConfig;
  /**
   * 本实例的“有效根”。基础实例等于 config.root；经 {@link forSession} 派生的
   * 会话视图则为 `<config.root>/<sessionsDir>/<sessionId>`。所有路径边界校验都
   * 以此为基准，从而把沙箱收缩到会话子目录。
   */
  private root: string;

  constructor(configService: ConfigService) {
    this.config = loadWorkspaceConfig(configService);
    this.root = this.config.root;
  }

  getConfig(): Readonly<WorkspaceConfig> {
    return this.config;
  }

  /**
   * 派生一个“换了根”的会话作用域视图，复用同一份 config 与全部沙箱逻辑。
   *
   * - 未开启隔离、或未提供 sessionId：返回自身（回退到共享根，行为不变）。
   * - 否则：有效根收缩为 `<root>/<sessionsDir>/<sanitized sessionId>`，
   *   其余 session、基础根下的旧文件与 `.specify` 都落在该根之外，自动不可访问。
   */
  forSession(sessionId?: string): WorkspaceService {
    if (!this.config.isolateBySession || !sessionId) return this;
    /**
     * 用 Object.create(prototype) 造一个"空壳"实例，
     * 跳过 constructor —— 不重新走 DI、不重新 loadWorkspaceConfig，
     * 也不复制方法（原型链上都有）。
     */
    const scoped: WorkspaceService = Object.create(WorkspaceService.prototype);
    scoped.config = this.config;
    scoped.root = path.join(
      this.config.root,
      this.config.sessionsDir,
      this.sanitizeSessionId(sessionId),
    );
    return scoped;
  }

  /**
   * 确保当前有效根存在（隔离开启且提供 sessionId 时）。
   * 让新会话的 `list_dir .`、`run_command` 的 cwd 不至于因目录缺失而报错。
   */
  async ensureSessionRoot(sessionId?: string): Promise<void> {
    if (!this.config.isolateBySession || !sessionId) return;
    const dir = path.join(
      this.config.root,
      this.config.sessionsDir,
      this.sanitizeSessionId(sessionId),
    );
    await fs.mkdir(dir, { recursive: true });
  }

  /**
   * 把 sessionId 收敛成单个安全路径段：仅保留 [A-Za-z0-9._-]，其余替换为 `_`。
   * `randomUUID()` 原样通过；空串或 `.`/`..` 一律拒绝，杜绝路径逃逸。
   */
  private sanitizeSessionId(sessionId: string): string {
    const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, '_');
    if (!safe || safe === '.' || safe === '..') {
      throw new WorkspaceError('INVALID_PATH', `非法 sessionId：${sessionId}`);
    }
    return safe;
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

    // 允许 LLM 传入绝对路径 —— 但必须落在有效根内；相对路径以有效根为基。
    const abs = path.isAbsolute(userPath)
      ? path.resolve(userPath)
      : path.resolve(this.root, userPath);

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

  /** 供工具层展示：把绝对路径转成相对有效根的展示路径 */
  toRelative(abs: string): string {
    const rel = path.relative(this.root, abs);
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
      : this.root;

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

      const limit = this.config.maxCommandOutput;
      const stdout: OutputBuf = { chunks: [], size: 0 };
      const stderr: OutputBuf = { chunks: [], size: 0 };
      let truncated = false;
      let timedOut = false;

      /**
       * 把一段输出追加到缓冲区，返回是否发生了截断。
       * 命中上限后当前数据被裁剪；再后续数据整段丢弃并直接返回 true。
       */
      const push = (buf: OutputBuf, data: string): boolean => {
        const remain = limit - buf.size;
        if (remain <= 0) return true;
        if (data.length > remain) {
          buf.chunks.push(data.slice(0, remain));
          buf.size += remain;
          return true;
        }
        buf.chunks.push(data);
        buf.size += data.length;
        return false;
      };

      child.stdout.setEncoding('utf-8');
      child.stderr.setEncoding('utf-8');

      child.stdout.on('data', (data: string) => {
        if (push(stdout, data)) truncated = true;
      });
      child.stderr.on('data', (data: string) => {
        if (push(stderr, data)) truncated = true;
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
          stdout: stdout.chunks.join(''),
          stderr: stderr.chunks.join(''),
          timedOut,
          truncated,
        });
      });
    });
  }

  // =====================================================================
  // 私有工具
  // =====================================================================

  /** 判断 abs 是否位于有效根内（含根本身） */
  private isInsideRoot(abs: string): boolean {
    const rel = path.relative(this.root, abs);
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

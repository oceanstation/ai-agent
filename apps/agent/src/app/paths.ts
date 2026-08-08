import * as path from 'node:path';

/**
 * Agent 侧路径解析工具。
 *
 * 目的：让本仓库既能作为 CLI/Web 服务运行（默认落到仓库根 `process.cwd()`），
 * 也能被 Electron 等桌面壳直接内嵌 —— 桌面壳只需在启动前设置
 * `process.env.AGENT_DATA_DIR = app.getPath('userData')`，
 * 就能让 history / memory / skills / workspace / HF cache 一次性重定位到用户目录，
 * 避免打包后 `process.cwd()` 落到只读的安装目录。
 *
 * 解析优先级：
 *   1. 显式环境变量（如 HISTORY_DB_PATH / MEMORY_ROOT ...）——最高优先级；
 *   2. AGENT_DATA_DIR + 子系统默认子路径（如 `.memory`、`.data/history.db`）；
 *   3. 仓库根（process.cwd()）+ 兼容旧默认路径（`apps/agent/.memory` 等）。
 *
 * 所有函数都返回**绝对路径**，调用方无需再自行 resolve。
 */

/** 读取 AGENT_DATA_DIR（若已设置），返回绝对路径；未设置返回 null */
export function getAgentDataDir(): string | null {
  const raw = process.env.AGENT_DATA_DIR?.trim();
  if (!raw) return null;
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

/**
 * 通用解析器：
 *   - 若 `rawValue` 已显式指定，则相对 cwd 解析后返回；
 *   - 否则若 `AGENT_DATA_DIR` 有值，则拼 `dataDirSubPath`；
 *   - 否则退回 `legacyDefault`（保持旧行为，相对 cwd）。
 */
export function resolveAgentPath(
  rawValue: string | undefined,
  dataDirSubPath: string,
  legacyDefault: string,
): string {
  if (rawValue && rawValue.trim()) {
    const v = rawValue.trim();
    return path.isAbsolute(v) ? v : path.resolve(process.cwd(), v);
  }
  const dataDir = getAgentDataDir();
  if (dataDir) {
    return path.join(dataDir, dataDirSubPath);
  }
  return path.isAbsolute(legacyDefault)
    ? legacyDefault
    : path.resolve(process.cwd(), legacyDefault);
}

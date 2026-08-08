/**
 * Electron 主进程入口（Phase 1）。
 *
 * 三进程编排：
 *   main (this)  ── utilityProcess.fork ──▶  agent (Nest + node:sqlite)
 *      │                                        │
 *      └── BrowserWindow ── loadURL ──▶ Vite dev server (:4200) ── HTTP proxy /agent ──▶ agent
 *
 * Phase 1 约定：
 *   - Agent 以 utilityProcess 子进程运行，通过 `execArgv: ['--experimental-sqlite']`
 *     解决 HistoryService 依赖 node:sqlite 的启动 flag（main 内嵌方案打包后无法透出该 flag，
 *     这也是切到 utilityProcess 的直接原因）；
 *   - PORT 固定为 3000，复用 Vite dev server 已配置的 `/agent` 代理，前端零改动；
 *   - agent 侧在 `createAgent()` 成功后，若检测到 `process.parentPort`（Electron utility 环境），
 *     会 postMessage `{type:'agent:ready', port, url}` 回来，本文件据此决定何时开窗；
 *   - `AGENT_DATA_DIR` 设为 `app.getPath('userData')`，history/memory/skills/workspace/HF cache
 *     全部落到用户目录，避开打包后 `process.cwd()` = 只读安装目录的坑（`apps/agent/src/app/paths.ts`
 *     的 `resolveAgentPath` 已配好）。
 *
 * Phase 2 会把 PORT 改为 0（OS 分配）+ 通过 `__AGENT_ORIGIN__` 直连而不走 Vite proxy，
 * 本文件的 `additionalArguments` / preload 已经为此备好通道。
 */
import { app, BrowserWindow, ipcMain, shell, utilityProcess, type UtilityProcess } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';

// 显式设置产品名，让 `app.getPath('userData')` 落到 `~/Library/Application Support/AI Agent/`
// 而不是 package.json 里 name 字段的 `@ai-agent/desktop`（不友好、含斜杠）。
// 必须在 `app.whenReady()` 之前调用，否则 userData 路径已被缓存。
app.setName('AI Agent');

const isDev = !app.isPackaged;

// Phase 2：OS 分配端口，agent 通过 `agent:ready` 消息把实际端口/URL 回传，
// preload 再把 origin 注入 renderer，前端直连内嵌 agent（不经 Vite proxy）。
// 传 '0' 让 Node 选一个未占用端口 —— 与 `pnpm dev`（占 :3000）并存不冲突。
const AGENT_PORT = '0';

// ---------------------------------------------------------------------------
// 路径解析
// ---------------------------------------------------------------------------
function resolveAgentEntry(): string {
  if (isDev) {
    // apps/desktop/dist/main.js  →  apps/agent/dist/main.js
    return path.resolve(__dirname, '../../agent/dist/main.js');
  }
  // Phase 3 打包布局，先占位
  return path.resolve(process.resourcesPath, 'agent/main.js');
}

// ---------------------------------------------------------------------------
// Agent utility 子进程
// ---------------------------------------------------------------------------
interface AgentReady {
  port: number;
  url: string;
}

let agentProcess: UtilityProcess | null = null;

function startAgent(): Promise<AgentReady> {
  const entry = resolveAgentEntry();
  if (!fs.existsSync(entry)) {
    return Promise.reject(
      new Error(
        `Agent bundle not found: ${entry}\n` +
          `Run 'pnpm nx build @ai-agent/agent' first.`,
      ),
    );
  }

  // dev：cwd 指向仓库根，让 `resolveAgentPath` 的 legacy 默认路径（apps/agent/.memory、
  // .models、apps/agent/.data/history.db、apps/agent/.skills 等）能命中你已有的数据 ——
  // 等价 `pnpm dev` 的行为，避免每次 Electron 启动都从空状态起。
  // prod（Phase 3）会切换到 userData：AGENT_DATA_DIR = app.getPath('userData')
  //   + 首启动种子拷贝。
  const repoRoot = path.resolve(__dirname, '../../..');
  const agentCwd = isDev ? repoRoot : app.getPath('userData');

  return new Promise<AgentReady>((resolve, reject) => {
    const child = utilityProcess.fork(entry, [], {
      cwd: agentCwd,
      // Electron 43 内置 Node 24，`node:sqlite` 已 stable，无 flag 亦可加载。
      // 保留 `--experimental-sqlite` 是为了兼容 Electron ≤38（Node 22 系需此 flag），
      // Node 24 会静默忽略这个未知选项，无副作用。
      execArgv: ['--experimental-sqlite'],
      // pipe 后手动 forward 到 main 进程 stdout，方便一处看日志
      stdio: 'pipe',
      serviceName: 'ai-agent-agent',
      env: {
        ...process.env,
        // 只在打包后启用 userData 集中；dev 保持不设，走 legacy 相对 cwd 路径
        ...(isDev ? {} : { AGENT_DATA_DIR: app.getPath('userData') }),
        // Workspace 默认放开写入，桌面端本地场景无需担心租户隔离
        WORKSPACE_WRITABLE: process.env.WORKSPACE_WRITABLE ?? 'true',
        // Renderer 直连内嵌 agent 属跨源（`file://`/`localhost:4200` → `127.0.0.1:<port>`），
        // 需 agent 侧启用 CORS。agent 只绑 loopback，反射来源在此场景安全。
        AGENT_CORS: 'true',
        PORT: AGENT_PORT,
        HOST: '127.0.0.1',
      },
    });

    agentProcess = child;

    child.stdout?.on('data', (chunk: Buffer) => {
      process.stdout.write(`[agent] ${chunk.toString()}`);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(`[agent] ${chunk.toString()}`);
    });

    child.on('message', (msg: unknown) => {
      if (msg && typeof msg === 'object' && 'type' in msg) {
        const m = msg as { type: string; port?: number; url?: string; message?: string };
        if (m.type === 'agent:ready' && m.url && typeof m.port === 'number') {
          resolve({ port: m.port, url: m.url });
        } else if (m.type === 'agent:error') {
          reject(new Error(m.message ?? 'agent failed to start'));
        }
      }
    });

    child.on('exit', (code: number) => {
      console.log(`[agent] utility process exited (code=${code})`);
      agentProcess = null;
    });
  });
}

// ---------------------------------------------------------------------------
// Vite 就绪探测
// ---------------------------------------------------------------------------
// dev 下 electron 和 vite 可能被并行拉起（`pnpm dev:desktop`），
// electron 早于 vite 就绪时 `loadURL(:4200)` 会 net::ERR_CONNECTION_REFUSED。
// 用 fetch 轮询 —— 拿到任何 HTTP 响应就算就绪，网络错误则继续等。
async function waitForVite(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  console.log(`[desktop] waiting for Vite dev server at ${url}...`);
  while (Date.now() < deadline) {
    try {
      await fetch(url);
      return;
    } catch {
      // ECONNREFUSED / DNS / socket reset → vite 还没起来，继续
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(
    `Vite dev server did not become ready at ${url} within ${timeoutMs}ms`,
  );
}

// ---------------------------------------------------------------------------
// 主窗口
// ---------------------------------------------------------------------------
async function createWindow(agentOrigin: string): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // preload 会解析这个 arg，通过 contextBridge 挂到 window.__AGENT_ORIGIN__，
      // renderer 侧的 http.ts 据此决定 baseURL —— 桌面模式直连内嵌 agent。
      additionalArguments: [`--agent-origin=${agentOrigin}`],
    },
  });

  if (isDev) {
    const devUrl = 'http://localhost:4200';
    // 先等 Vite dev server 起来（可能是 `pnpm dev:desktop` 并行拉起的）
    await waitForVite(devUrl);
    await win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    // Phase 3 会落地
    await win.loadFile(path.resolve(process.resourcesPath, 'ui/index.html'));
  }

  return win;
}

// ---------------------------------------------------------------------------
// 首启动 .env 种子 + IPC
// ---------------------------------------------------------------------------
/**
 * 若 userData/.env 不存在，从 extraResources 里拷贝 .env.example 过去。
 * 这样打包后用户拿到 app 双击，userData 里立刻有一份"框架已在、值为空"的模板，
 * 引导 UI 只需要提示用户去填 API key 就够了。
 *
 * dev 模式跳过 —— dev 下 .env 已经在仓库根，是你日常在改的那一份。
 */
function seedEnvFileIfMissing(): void {
  if (isDev) return;
  const userDataEnv = path.join(app.getPath('userData'), '.env');
  if (fs.existsSync(userDataEnv)) return;

  const template = path.join(process.resourcesPath, '.env.example');
  if (!fs.existsSync(template)) {
    console.warn(`[desktop] .env.example not found at ${template}, skip seeding`);
    return;
  }

  try {
    fs.mkdirSync(path.dirname(userDataEnv), { recursive: true });
    fs.copyFileSync(template, userDataEnv);
    console.log(`[desktop] seeded ${userDataEnv} from template`);
  } catch (err) {
    console.error('[desktop] failed to seed .env:', err);
  }
}

/**
 * 供 renderer 调用的桌面 API：
 *  - `desktop:open-data-dir` 在 Finder 里打开 userData
 *  - `desktop:reload-window`  重启 utility 进程 + 重载窗口（改完 .env 后触发）
 *
 * 用 handle/invoke 而非 send/on —— 前者是 Promise-based，UI 侧更好用。
 */
function registerIpcHandlers(): void {
  ipcMain.handle('desktop:open-data-dir', async () => {
    const dir = app.getPath('userData');
    const err = await shell.openPath(dir);
    return { path: dir, error: err || null };
  });

  ipcMain.handle('desktop:reload-window', async () => {
    // 先 kill agent utility，主 bootstrap 会重启它
    if (agentProcess) {
      agentProcess.kill();
      agentProcess = null;
    }
    // 重新拉一个 agent，然后让窗口重载
    agentInfo = await startAgent();
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      // 更新 additionalArguments —— 但已开窗的 renderer 拿不到新 origin，
      // 直接 reload 也会用旧 __AGENT_ORIGIN__。简单起见：关窗+开新窗
      win.close();
      await createWindow(agentInfo.url);
    }
    return { url: agentInfo.url };
  });
}

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------
let agentInfo: AgentReady | null = null;

async function bootstrap() {
  seedEnvFileIfMissing();
  registerIpcHandlers();
  agentInfo = await startAgent();
  console.log(
    `[desktop] agent ready at ${agentInfo.url}, data dir: ${app.getPath('userData')}`,
  );
  await createWindow(agentInfo.url);
}

app.whenReady().then(bootstrap).catch((err) => {
  console.error('[desktop] bootstrap failed:', err);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0 && agentInfo) {
    await createWindow(agentInfo.url);
  }
});

// 优雅关闭：让 agent 先收到 SIGTERM，触发 Nest onModuleDestroy 钩子（sqlite/chroma 清理）
app.on('before-quit', () => {
  if (agentProcess) {
    agentProcess.kill();
    agentProcess = null;
  }
});

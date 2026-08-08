/**
 * Electron preload：桥接 renderer ↔ main。
 *
 * 挂到 window 的三件东西（用 contextBridge，因为主进程开了 contextIsolation=true）：
 *   - `__AGENT_ORIGIN__`   内嵌 agent 的 HTTP origin（http://127.0.0.1:<port>），
 *                           renderer 侧 `apps/ui/src/api/http.ts` 据此决定 baseURL；
 *   - `__IS_DESKTOP__`      布尔标志，UI 差异化时用（如引导条只在桌面显示）；
 *   - `__DESKTOP_API__`     异步方法集，走 ipcRenderer.invoke 到 main：
 *       - `openDataDir()`   在 Finder 打开 userData
 *       - `reloadApp()`     kill agent + 重开窗口（用户改完 .env 后触发）
 */
import { contextBridge, ipcRenderer } from 'electron';

function readAgentOrigin(): string {
  const prefix = '--agent-origin=';
  for (const arg of process.argv) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return '';
}

contextBridge.exposeInMainWorld('__AGENT_ORIGIN__', readAgentOrigin());
contextBridge.exposeInMainWorld('__IS_DESKTOP__', true);
contextBridge.exposeInMainWorld('__DESKTOP_API__', {
  openDataDir: (): Promise<{ path: string; error: string | null }> =>
    ipcRenderer.invoke('desktop:open-data-dir'),
  reloadApp: (): Promise<{ url: string }> =>
    ipcRenderer.invoke('desktop:reload-window'),
});

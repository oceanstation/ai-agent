/**
 * Renderer 端全局注入：由 Electron preload（`apps/desktop/src/preload.ts`）通过
 * `contextBridge.exposeInMainWorld` 挂在 window 上。
 *
 * - `__AGENT_ORIGIN__`：内嵌 agent 的 HTTP origin（如 `http://127.0.0.1:52341`）；
 *   web 模式下为空字符串 / undefined。`apps/ui/src/api/http.ts` 据此决定 baseURL。
 * - `__IS_DESKTOP__`：布尔标志，桌面壳里为 true；用于 UI 差异化（如引导条只在桌面显示）。
 * - `__DESKTOP_API__`：由 preload 通过 ipcRenderer.invoke 转发到 main 的方法集，
 *   仅桌面模式可用；web 模式下为 undefined。
 *
 * 类型不影响运行时行为 —— 只是让 TS 严格模式下 `window.__AGENT_ORIGIN__` 可访问。
 */
export {};

declare global {
  interface DesktopApi {
    /** 在 Finder / 文件管理器打开 userData 目录 */
    openDataDir(): Promise<{ path: string; error: string | null }>;
    /** 重启内嵌 agent + 重载窗口（用户改完 .env 后调） */
    reloadApp(): Promise<{ url: string }>;
  }

  interface Window {
    __AGENT_ORIGIN__?: string;
    __IS_DESKTOP__?: boolean;
    __DESKTOP_API__?: DesktopApi;
  }
}

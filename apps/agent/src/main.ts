import { Logger, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AddressInfo } from 'node:net';
import { AppModule } from './app/app.module';

export interface CreatedAgent {
  /** Nest 应用实例（供内嵌方在关闭时调用 app.close()） */
  app: INestApplication;
  /** 实际监听端口（port=0 时会被 OS 分配） */
  port: number;
  /** 完整的 HTTP 根地址（含协议 + 127.0.0.1 + port，无尾斜杠） */
  url: string;
}

/**
 * 创建并启动 Nest Agent。
 *
 * - 独立函数，便于 Electron / 测试等场景内嵌使用；
 * - 默认监听 `127.0.0.1`，避免桌面场景下把服务无意暴露到局域网；
 * - 传 `port=0` 时会使用一个 OS 分配的随机可用端口，返回值里可拿到最终 port。
 */
export async function createAgent(
  port: number | string = process.env.PORT ?? 3000,
  host = process.env.HOST ?? '127.0.0.1',
): Promise<CreatedAgent> {
  const app = await NestFactory.create(AppModule);
  // 开启 shutdown hooks：让进程收到 SIGTERM/SIGINT 时能正常触发各 provider 的 onModuleDestroy，实现优雅退出。
  app.enableShutdownHooks();

  // 内嵌场景（Electron desktop / 其他跨源前端）需要 CORS。
  // 通过 `AGENT_CORS=true` env 门控 —— web 部署默认关闭。
  // origin:true 会反射 request Origin 头（等价"允许所有来源"），
  // 因 agent 默认只绑 127.0.0.1，外部网络本就到不了，反射是安全的。
  if (process.env.AGENT_CORS === 'true') {
    app.enableCors({ origin: true, credentials: true });
  }

  await app.listen(Number(port), host);

  const server = app.getHttpServer();
  const addr = server.address() as AddressInfo | string | null;
  const actualPort =
    typeof addr === 'object' && addr ? addr.port : Number(port);
  const url = `http://${host}:${actualPort}`;

  Logger.log(`🚀 Agent server is running on: ${url}`);
  return { app, port: actualPort, url };
}

/**
 * 若被 Electron `utilityProcess.fork()` 拉起，`process.parentPort` 会出现
 * （Node 端标准 API 里没有，是 Electron 注入的通信端口）。
 * 用它把就绪信号 postMessage 回 main 进程，让 main 知道何时可以开窗。
 * 纯 CLI 场景下 `parentPort` 为 undefined，不影响原路径。
 */
type ParentPortLike = { postMessage: (msg: unknown) => void };
function getParentPort(): ParentPortLike | undefined {
  const p = (process as unknown as { parentPort?: ParentPortLike }).parentPort;
  return p && typeof p.postMessage === 'function' ? p : undefined;
}

// 保留原有 CLI 行为：直接执行本文件（webpack bundle 入口）时启动服务。
if (require.main === module) {
  createAgent()
    .then(({ port, url }) => {
      getParentPort()?.postMessage({ type: 'agent:ready', port, url });
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Failed to start agent:', err);
      getParentPort()?.postMessage({
        type: 'agent:error',
        message: err instanceof Error ? err.message : String(err),
      });
      process.exit(1);
    });
}

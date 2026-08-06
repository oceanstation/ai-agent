import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // 开启 shutdown hooks：让进程收到 SIGTERM/SIGINT 时能正常触发各 provider 的 onModuleDestroy，实现优雅退出。
  app.enableShutdownHooks();
  const port = process.env.PORT || 3000;
  await app.listen(port);
  Logger.log(`🚀 Agent server is running on: http://localhost:${port}`);
}

bootstrap();

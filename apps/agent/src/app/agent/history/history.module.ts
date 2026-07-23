import { Module } from '@nestjs/common';
import { HistoryService } from './history.service';

/**
 * History 模块：暴露 HistoryService 给 AgentModule 使用。
 *
 * 依赖 ConfigModule 已在 AppModule 全局注册（isGlobal=true），
 * 所以本模块无需再显式 import ConfigModule。
 */
@Module({
  providers: [HistoryService],
  exports: [HistoryService],
})
export class HistoryModule {}

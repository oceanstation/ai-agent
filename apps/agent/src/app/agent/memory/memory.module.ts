import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service';

/**
 * Memory 模块：暴露 MemoryService 给 AgentModule 使用。
 *
 * 依赖 ConfigModule 已在 AppModule 全局注册（isGlobal=true），
 * 所以本模块无需再显式 import ConfigModule。
 */
@Module({
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}

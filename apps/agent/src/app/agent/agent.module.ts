import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { BootstrapModule } from './bootstrap/bootstrap.module';
import { MemoryModule } from './memory/memory.module';
import { HistoryModule } from './history/history.module';
import { SkillModule } from './skills/skill.module';

@Module({
  imports: [
    MemoryModule,
    HistoryModule,
    SkillModule,
    BootstrapModule,
  ],
  controllers: [AgentController],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}

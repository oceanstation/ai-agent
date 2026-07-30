import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { BootstrapModule } from './bootstrap/bootstrap.module';
import { MemoryModule } from './memory/memory.module';
import { HistoryModule } from './history/history.module';
import { SddModule } from './sdd/sdd.module';
import { SkillModule } from './skills/skill.module';
import { WorkspaceModule } from './workspace/workspace.module';

@Module({
  imports: [
    MemoryModule,
    HistoryModule,
    SkillModule,
    WorkspaceModule,
    SddModule,
    BootstrapModule,
  ],
  controllers: [AgentController],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}

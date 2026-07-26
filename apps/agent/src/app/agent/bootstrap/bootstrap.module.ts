import { Module } from '@nestjs/common';
import { WorkspaceModule } from '../workspace/workspace.module';
import { MemoryModule } from '../memory/memory.module';
import { SkillModule } from '../skills/skill.module';
import { HistoryModule } from '../history/history.module';
import { BootstrapService } from './bootstrap.service';
import { BOOTSTRAP_CHECKS } from './bootstrap.types';
import { WorkspaceCheck } from './checks/workspace.check';
import { HistoryCheck } from './checks/history.check';
import { SkillCheck } from './checks/skill.check';
import { MemoryCheck } from './checks/memory.check';

/**
 * BootstrapModule：集中挂载所有"启动自检"项。
 *
 * 新增自检项的步骤：
 *   1. 在 checks/ 下实现 BootstrapCheck 接口；
 *   2. 在本文件的 providers 中注册该 class；
 *   3. 把 class 追加进 BOOTSTRAP_CHECKS 工厂返回的数组（顺序即打印顺序）。
 * BootstrapService 本身无需改动，天然支持扩展。
 */
@Module({
  imports: [WorkspaceModule, HistoryModule, SkillModule, MemoryModule],
  providers: [
    WorkspaceCheck,
    HistoryCheck,
    SkillCheck,
    MemoryCheck,
    // 未来新增 check 时，在此处追加即可
    {
      provide: BOOTSTRAP_CHECKS,
      // 顺序即打印顺序：先基础设施（工作目录/历史库），再上层能力（skills/memory）
      useFactory: (
        workspace: WorkspaceCheck,
        history: HistoryCheck,
        skills: SkillCheck,
        memory: MemoryCheck,
      ) => [workspace, history, skills, memory],
      inject: [WorkspaceCheck, HistoryCheck, SkillCheck, MemoryCheck],
    },
    BootstrapService,
  ],
  exports: [BootstrapService],
})
export class BootstrapModule {}

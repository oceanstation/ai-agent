import { Module } from '@nestjs/common';
import { WorkspaceModule } from '../workspace/workspace.module';
import { BootstrapService } from './bootstrap.service';
import { BOOTSTRAP_CHECKS } from './bootstrap.types';
import { WorkspaceCheck } from './checks/workspace.check';

/**
 * BootstrapModule：集中挂载所有"启动自检"项。
 *
 * 新增自检项的步骤：
 *   1. 在 checks/ 下实现 BootstrapCheck 接口；
 *   2. 在本文件的 providers 中注册该 class；
 *   3. 把 class 追加进 BOOTSTRAP_CHECKS 工厂返回的数组。
 * BootstrapService 本身无需改动，天然支持扩展。
 */
@Module({
  imports: [WorkspaceModule],
  providers: [
    WorkspaceCheck,
    // 未来新增 check 时，在此处追加即可
    {
      provide: BOOTSTRAP_CHECKS,
      useFactory: (workspaceCheck: WorkspaceCheck) => [workspaceCheck],
      inject: [WorkspaceCheck],
    },
    BootstrapService,
  ],
  exports: [BootstrapService],
})
export class BootstrapModule {}

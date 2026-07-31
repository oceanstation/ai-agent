import { Global, Module } from '@nestjs/common';
import { LlmService } from './llm.service';
import { IntentRouterService } from './intent-router.service';

@Global()
@Module({
  providers: [LlmService, IntentRouterService],
  exports: [LlmService, IntentRouterService],
})
export class LlmModule {}

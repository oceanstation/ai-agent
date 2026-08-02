import { Module } from '@nestjs/common';
import { BgeEmbedder } from './bge-embedder';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';

@Module({
  controllers: [KnowledgeController],
  providers: [BgeEmbedder, KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}

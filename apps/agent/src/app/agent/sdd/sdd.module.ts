import { Module } from '@nestjs/common';
import { SddService } from './sdd.service';

@Module({
  providers: [SddService],
  exports: [SddService],
})
export class SddModule {}

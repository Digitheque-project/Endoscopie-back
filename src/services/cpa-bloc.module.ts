import { Module } from '@nestjs/common';
import { CpaBlocService } from './cpa-bloc.service';

@Module({
  providers: [CpaBlocService],
  exports: [CpaBlocService],
})
export class CpaBlocModule {}

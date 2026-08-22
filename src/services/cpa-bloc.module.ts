import { Module } from '@nestjs/common';
import { CpaBlocService } from './cpa-bloc.service';
import { MedecinsModule } from './medecins.module';

@Module({
  imports: [MedecinsModule],
  providers: [CpaBlocService],
  exports: [CpaBlocService],
})
export class CpaBlocModule {}

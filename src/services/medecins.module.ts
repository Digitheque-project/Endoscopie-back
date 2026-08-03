import { Module } from '@nestjs/common';
import { MedecinsService } from './medecins.service';

@Module({
  providers: [MedecinsService],
  exports: [MedecinsService],
})
export class MedecinsModule {}

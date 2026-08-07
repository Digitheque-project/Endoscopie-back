import { Module } from '@nestjs/common';
import { DossierPatientController } from './dossier-patient.controller';
import { DossierPatientService } from '../services/dossier-patient.service';
import { MedecinsModule } from '../services/medecins.module';

@Module({
  imports: [MedecinsModule],
  controllers: [DossierPatientController],
  providers: [DossierPatientService],
  exports: [DossierPatientService],
})
export class DossierPatientModule {}

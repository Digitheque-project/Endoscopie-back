import { Module } from '@nestjs/common';
import { ExternalApiController } from './external-api.controller';
import { ExternalApiService } from '../services/external-api.service';
import { MedecinsModule } from '../services/medecins.module';

@Module({
  imports: [MedecinsModule],
  controllers: [ExternalApiController],
  providers: [ExternalApiService],
  exports: [ExternalApiService],
})
export class ExternalApiModule {}

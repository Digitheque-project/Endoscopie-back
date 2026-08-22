import { Module } from '@nestjs/common';
import { ServiceSourceController } from './service-source.controller';
import { ServiceSourceService } from '../services/service-source.service';
import { PrismaService } from '../prisma/prisma.service';
import { MedecinsModule } from '../services/medecins.module';

@Module({
  imports: [MedecinsModule],
  controllers: [ServiceSourceController],
  providers: [ServiceSourceService, PrismaService],
  exports: [ServiceSourceService],
})
export class ServiceSourceModule {}

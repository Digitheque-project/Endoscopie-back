import { Module } from '@nestjs/common';
import { ServiceSourceController } from './service-source.controller';
import { ServiceSourceService } from '../services/service-source.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [ServiceSourceController],
  providers: [ServiceSourceService, PrismaService],
  exports: [ServiceSourceService],
})
export class ServiceSourceModule {}

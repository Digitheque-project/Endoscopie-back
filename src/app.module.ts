import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RolesGuard } from './auth/roles.guard';
import { RequestContextMiddleware } from './auth/request-context';
import { NotificationModule } from './notification/notification.module';
import { PrismaModule } from './prisma/prisma.module';
import { ExternalApiModule } from './external-api/external-api.module';
import { ServiceSourceModule } from './service-source/service-source.module';
import { MedecinsModule } from './services/medecins.module';
import { CpaBlocModule } from './services/cpa-bloc.module';

@Module({
  imports: [
    PrismaModule,
    NotificationModule,
    ExternalApiModule,
    ServiceSourceModule,
    MedecinsModule,
    CpaBlocModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: RolesGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}

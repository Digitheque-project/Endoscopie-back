import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { NotificationModule } from './notification/notification.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, NotificationModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationInboxService } from './notification-inbox.service';
import { NotificationInboxController } from './notification-inbox.controller';
import { CpaBlocModule } from '../services/cpa-bloc.module';

@Module({
  imports: [CpaBlocModule],
  controllers: [NotificationInboxController],
  providers: [NotificationService, NotificationInboxService],
  exports: [NotificationService, NotificationInboxService],
})
export class NotificationModule {}

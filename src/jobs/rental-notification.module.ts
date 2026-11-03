import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { JobsModule } from './jobs.module';
import { RentalNotificationWorker } from './rental-notification.worker';

@Module({
  imports: [JobsModule, EmailModule],
  providers: [RentalNotificationWorker],
  exports: [RentalNotificationWorker],
})
export class RentalNotificationModule {}

import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { RentalNotificationModule } from '../jobs/rental-notification.module';

@Module({
  imports: [DatabaseModule, RentalNotificationModule],
  exports: [RentalNotificationModule],
})
export class WorkerModule {}

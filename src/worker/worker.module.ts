import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { RentalConfirmationModule } from '../jobs/rental-confirmation.module';

@Module({
  imports: [DatabaseModule, RentalConfirmationModule],
  exports: [RentalConfirmationModule],
})
export class WorkerModule {}

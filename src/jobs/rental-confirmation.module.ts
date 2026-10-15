import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { JobsModule } from './jobs.module';
import { RentalConfirmationWorker } from './rental-confirmation.worker';

@Module({
  imports: [JobsModule, EmailModule],
  providers: [RentalConfirmationWorker],
  exports: [RentalConfirmationWorker],
})
export class RentalConfirmationModule {}

import { NestFactory } from '@nestjs/core';
import { z } from 'zod';
import { RentalConfirmationWorker } from '../jobs/rental-confirmation.worker';
import { WorkerModule } from './worker.module';

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter(arg => arg !== '--');
  const jobIds = z.array(z.uuid()).min(1, 'Pass at least one job ID').parse(args);
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    await app.get(RentalConfirmationWorker).run(jobIds);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('Email worker failed:', error);
  process.exitCode = 1;
});

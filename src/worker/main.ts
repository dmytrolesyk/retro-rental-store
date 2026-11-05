import { NestFactory } from '@nestjs/core';
import { z } from 'zod';
import { RentalNotificationWorker } from '../jobs/rental-notification.worker';
import { WorkerModule } from './worker.module';

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter(arg => arg !== '--');
  const watch = args.length === 1 && args[0] === '--watch';
  const jobIds = watch ? [] : z.array(z.uuid()).min(1, 'Pass job IDs or --watch').parse(args);
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['error', 'warn'],
    abortOnError: false,
  });
  const shutdown = new AbortController();
  const stop = () => {
    shutdown.abort();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    const worker = app.get(RentalNotificationWorker);
    if (watch) await worker.runForever(shutdown.signal);
    else await worker.run(jobIds);
  } finally {
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('Email worker failed:', error);
  process.exitCode = 1;
});

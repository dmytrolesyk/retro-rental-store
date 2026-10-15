import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransactionRetryService } from './transaction-retry.service';
import { createDataSourceOptions } from './data-source-options';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => createDataSourceOptions(),
    }),
  ],
  providers: [TransactionRetryService],
  exports: [TransactionRetryService],
})
export class DatabaseModule {}

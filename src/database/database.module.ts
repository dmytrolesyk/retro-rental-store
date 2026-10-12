import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { createDataSourceOptions } from './data-source-options';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => createDataSourceOptions(),
    }),
  ],
})
export class DatabaseModule {}

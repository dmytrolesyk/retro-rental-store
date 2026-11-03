import { ScheduleModule } from '@nestjs/schedule';
import { RentalDeadlinesModule } from './rentals/rental-deadlines.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { validateEnvConfig } from './config/env.schema';
import { DatabaseModule } from './database/database.module';
import { RentalsModule } from './rentals/rentals.module';
import { CatalogModule } from './catalog/catalog.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      validate: validateEnvConfig,
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    RentalDeadlinesModule,
    RentalsModule,
    CatalogModule,
  ],
  controllers: [AppController],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { validateEnvConfig } from './config/env.schema';
import { DatabaseModule } from './database/database.module';
import { RentalsModule } from './rentals/rentals.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      validate: validateEnvConfig,
    }),
    DatabaseModule,
    RentalsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}

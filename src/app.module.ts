import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { validateEnvConfig } from './config/env.schema';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvConfig,
    }),
    DatabaseModule,
  ],
  controllers: [AppController],
})
export class AppModule {}

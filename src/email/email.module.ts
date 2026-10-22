import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { Resend } from 'resend';
import { emailConfig } from '../config/email.config';
import { EMAIL_FROM, EmailService, RESEND_CLIENT } from './email.service';

@Module({
  imports: [ConfigModule.forFeature(emailConfig)],
  providers: [
    {
      provide: RESEND_CLIENT,
      inject: [emailConfig.KEY],
      useFactory: (config: ConfigType<typeof emailConfig>) => new Resend(config.apiKey),
    },
    {
      provide: EMAIL_FROM,
      inject: [emailConfig.KEY],
      useFactory: (config: ConfigType<typeof emailConfig>) => config.from,
    },
    EmailService,
  ],
  exports: [EmailService],
})
export class EmailModule {}

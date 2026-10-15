import { Inject, Injectable } from '@nestjs/common';
import type { Resend } from 'resend';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
}

export const RESEND_CLIENT = Symbol('RESEND_CLIENT');
export const EMAIL_FROM = Symbol('EMAIL_FROM');

@Injectable()
export class EmailService {
  constructor(
    @Inject(RESEND_CLIENT) private readonly client: { emails: Pick<Resend['emails'], 'send'> },
    @Inject(EMAIL_FROM) private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<string> {
    const { to, subject, text, idempotencyKey } = message;
    const { data, error } = await this.client.emails.send(
      { from: this.from, to, subject, text },
      { idempotencyKey },
    );
    if (error) throw new Error(`Resend: ${error.message}`);
    if (!data.id) throw new Error('Resend did not return an email ID');
    // API acceptance is not proof of inbox delivery.
    return data.id;
  }
}

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
    @Inject(RESEND_CLIENT)
    private readonly resendClient: { emails: Pick<Resend['emails'], 'send'> },
    @Inject(EMAIL_FROM) private readonly senderAddress: string,
  ) {}

  async send(message: EmailMessage): Promise<string> {
    const { to, subject, text, idempotencyKey } = message;
    const { data: emailReceipt, error } = await this.resendClient.emails.send(
      { from: this.senderAddress, to, subject, text },
      { idempotencyKey },
    );
    if (error) throw new Error(`Resend: ${error.message}`);
    if (!emailReceipt.id) throw new Error('Resend did not return an email ID');
    // API acceptance is not proof of inbox delivery.
    return emailReceipt.id;
  }
}

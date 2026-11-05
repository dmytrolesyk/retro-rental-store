import { Inject, Injectable } from '@nestjs/common';
import type { Resend } from 'resend';

export interface EmailMessage {
  from?: string;
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
}

export interface PreparedEmail extends EmailMessage {
  from: string;
}

export class EmailDeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
  }
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

  prepare(message: EmailMessage): PreparedEmail {
    return { ...message, from: message.from ?? this.senderAddress };
  }

  async send(message: EmailMessage): Promise<string> {
    const { from, to, subject, text, idempotencyKey } = this.prepare(message);
    const { data: emailReceipt, error } = await this.resendClient.emails.send(
      { from, to, subject, text },
      { idempotencyKey, signal: AbortSignal.timeout(10000) },
    );
    if (error) {
      const retryable =
        error.name === 'concurrent_idempotent_requests' ||
        error.statusCode === null ||
        error.statusCode === 429 ||
        error.statusCode >= 500;
      throw new EmailDeliveryError(error.name, retryable, `Resend: ${error.message}`);
    }
    if (!emailReceipt.id) throw new Error('Resend did not return an email ID');
    // API acceptance is not proof of inbox delivery.
    return emailReceipt.id;
  }
}

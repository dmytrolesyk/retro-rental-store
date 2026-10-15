import type { Resend } from 'resend';
import { EmailService } from './email.service';

describe('EmailService', () => {
  it('sends arbitrary email with the supplied idempotency key and throws API errors', async () => {
    const send = jest
      .fn<ReturnType<Resend['emails']['send']>, Parameters<Resend['emails']['send']>>()
      .mockResolvedValueOnce({ data: { id: 'email-1' }, error: null, headers: null })
      .mockResolvedValueOnce({
        headers: null,
        data: null,
        error: { name: 'rate_limit_exceeded', message: 'Rate limited', statusCode: 429 },
      });
    const service = new EmailService(
      { emails: { send } },
      'Rentals <notifications@send.example.com>',
    );
    const message = {
      to: 'delivered@resend.dev',
      subject: 'Account verification',
      text: 'Your verification code is 123456.',
      idempotencyKey: 'account-verification/request-42',
    };
    await expect(service.send(message)).resolves.toBe('email-1');
    await expect(service.send(message)).rejects.toThrow('Rate limited');
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
    expect(send.mock.calls[0][1]).toEqual({ idempotencyKey: message.idempotencyKey });
    expect(send.mock.calls[0][0]).toEqual({
      from: 'Rentals <notifications@send.example.com>',
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  });
});

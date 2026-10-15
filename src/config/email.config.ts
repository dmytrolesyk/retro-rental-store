import { registerAs } from '@nestjs/config';
import { z } from 'zod';

export const emailConfig = registerAs('email', () => {
  const env = z
    .object({
      RESEND_API_KEY: z.string().trim().min(1),
      EMAIL_FROM: z.string().trim().min(1),
    })
    .parse(process.env);

  return { apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM };
});

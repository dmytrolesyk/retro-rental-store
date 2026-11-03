import { z } from 'zod';
import { authIdentitiesEnvSchema } from '../auth/auth.config';
import { databaseEnvSchema } from './database-env.schema';

export const envSchema = databaseEnvSchema.safeExtend({
  AUTH_IDENTITIES: authIdentitiesEnvSchema,
  RENTAL_DEADLINES_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform(value => value === 'true'),
  PORT: z.coerce.number().int().min(1).max(65535),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
});

export type Env = z.infer<typeof envSchema>;

export const validateEnvConfig = (rawSchema: Record<string, unknown>): Env => {
  const parsed = envSchema.safeParse(rawSchema);
  if (!parsed.success) {
    const lines = parsed.error.issues
      .map(i => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${lines}\nCheck .env.example`);
  }
  return parsed.data;
};

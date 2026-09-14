import { z } from 'zod';

export const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(3000),
  PG_HOST: z.string(),
  PG_PORT: z.coerce.number().default(5432),
  PG_USER: z.string().min(1),
  PG_DB: z.string().min(1),
  PG_PASSWORD_FILE: z.string().min(1),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
});

export type Env = z.infer<typeof envSchema>;

export const validateEnvConfig = (rawSchema: Record<string, unknown>): Env => {
  const parsed = envSchema.safeParse(rawSchema);
  if (!parsed.success) {
    const lines = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configurtion:\n${lines}\nCheck .env.example`);
  }
  return parsed.data;
};

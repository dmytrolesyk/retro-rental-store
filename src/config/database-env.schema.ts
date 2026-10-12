import { z } from 'zod';

export const databaseEnvSchema = z
  .object({
    DB_HOST: z.string().min(1),
    DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
    DB_USER: z.string().min(1),
    DB_NAME: z.string().min(1),
    DB_PASSWORD: z.string().min(1).optional(),
    DB_PASSWORD_FILE: z.string().min(1).optional(),
  })
  .refine(env => Boolean(env.DB_PASSWORD) !== Boolean(env.DB_PASSWORD_FILE), {
    message: 'Set exactly one of DB_PASSWORD or DB_PASSWORD_FILE',
    path: ['DB_PASSWORD'],
  });

export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;

export function validateDatabaseEnv(raw: Record<string, unknown>): DatabaseEnv {
  const result = databaseEnvSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map(issue => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid database configuration:\n${issues}`);
  }
  return result.data;
}

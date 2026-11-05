import { z } from 'zod';

// TEMPORARY (HW18): hand-configured credentials until the authentication homework.
export const AUTH_IDENTITIES = Symbol('AUTH_IDENTITIES');

const id = z.uuid().transform(value => value.toLowerCase());
const token = z
  .string()
  .min(32)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/);
const identitiesSchema = z
  .array(
    z.discriminatedUnion('role', [
      z.object({ id, token, role: z.literal('client'), renterId: id }).strict(),
      z.object({ id, token, role: z.literal('staff') }).strict(),
    ]),
  )
  .refine(
    identities => new Set(identities.map(identity => identity.token)).size === identities.length,
  );

export type ConfiguredIdentity = z.infer<typeof identitiesSchema>[number];

/** Accept parsed config as well as env JSON. Never reflect credentials in errors. */
export function parseAuthIdentities(raw: unknown): ConfiguredIdentity[] {
  try {
    const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const parsed = identitiesSchema.safeParse(value ?? []);
    if (parsed.success) return parsed.data;
  } catch {
    /* Report only a sanitized configuration error below. */
  }
  throw new Error('Invalid AUTH_IDENTITIES configuration');
}

export const authIdentitiesEnvSchema = z
  .string()
  .default('[]')
  .transform((raw, context) => {
    try {
      return parseAuthIdentities(raw);
    } catch {
      context.addIssue({ code: 'custom', message: 'Invalid AUTH_IDENTITIES configuration' });
      return z.NEVER;
    }
  });

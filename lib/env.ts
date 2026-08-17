import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().default('file:./.pgdata'),
  DATABASE_DRIVER: z.enum(['pglite', 'postgres']).default('pglite'),
  SESSION_SECRET: z.string().min(32),
  CREDENTIAL_HMAC_SECRET: z.string().min(32),
  KIOSK_SECRET: z.string().min(32),
  CRON_SECRET: z.string().min(8),
  SMS_PROVIDER: z.enum(['console', 'twilio']).default('console'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  TWILIO_WEBHOOK_URL: z.string().optional(),
  NOT_ARRIVED_HOUR: z.coerce.number().int().min(0).max(23).default(17),
});

const DEV_FALLBACK = 'centerline-development-only-secret-do-not-use-in-prod';

/**
 * Parsed once per process. In development a missing secret falls back to a fixed
 * dev value so `pnpm dev` works from a bare checkout; in production a missing or
 * short secret is a hard failure.
 */
function load() {
  const raw = { ...process.env };
  if (process.env.NODE_ENV !== 'production') {
    raw.SESSION_SECRET ||= `${DEV_FALLBACK}-session`;
    raw.CREDENTIAL_HMAC_SECRET ||= `${DEV_FALLBACK}-credential`;
    raw.KIOSK_SECRET ||= `${DEV_FALLBACK}-kiosk`;
    raw.CRON_SECRET ||= 'dev-cron-secret';
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${missing}`);
  }
  return parsed.data;
}

export const env = load();
export type Env = z.infer<typeof schema>;

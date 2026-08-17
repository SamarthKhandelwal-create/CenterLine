import { config } from 'dotenv';

/**
 * CLI scripts must see exactly the same environment Next does, in the same
 * precedence order. Otherwise `pnpm db:seed` hashes credentials with one
 * CREDENTIAL_HMAC_SECRET while the running server validates against another, and
 * every printed QR code silently stops working.
 *
 * Order matches Next: .env.production.local / .env.local win over .env.
 * dotenv does not overwrite an already-set key, so listing the highest-priority
 * file first is what makes it win.
 */
config({
  path: [
    process.env.NODE_ENV === 'production' ? '.env.production.local' : '.env.development.local',
    '.env.local',
    '.env',
  ],
});

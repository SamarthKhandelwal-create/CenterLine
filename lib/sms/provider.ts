import { env } from '@/lib/env';

export type SmsSendResult =
  | { status: 'sent'; providerId: string | null }
  | { status: 'failed'; error: string };

export interface SmsProvider {
  readonly name: string;
  send(to: string, body: string): Promise<SmsSendResult>;
}

/**
 * A2P 10DLC registration takes 2-6 weeks with carriers, so real sending will not
 * work on day one. ConsoleProvider is the default: it logs, writes to message_log,
 * and sends nothing — every SMS path is fully testable without Twilio.
 */
export class ConsoleProvider implements SmsProvider {
  readonly name = 'console';

  async send(to: string, body: string): Promise<SmsSendResult> {
    console.log(`[sms:console] -> ${to}\n${body}\n`);
    return { status: 'sent', providerId: null };
  }
}

export class TwilioProvider implements SmsProvider {
  readonly name = 'twilio';

  async send(to: string, body: string): Promise<SmsSendResult> {
    const sid = env.TWILIO_ACCOUNT_SID;
    const token = env.TWILIO_AUTH_TOKEN;
    const from = env.TWILIO_FROM_NUMBER;
    if (!sid || !token || !from) {
      return { status: 'failed', error: 'twilio_not_configured' };
    }
    try {
      const { default: Twilio } = await import('twilio');
      const client = Twilio(sid, token);
      const message = await client.messages.create({ to, from, body });
      return { status: 'sent', providerId: message.sid };
    } catch (err) {
      const code = (err as { code?: number }).code;
      return { status: 'failed', error: code ? `twilio_${code}` : (err as Error).message.slice(0, 80) };
    }
  }
}

/** Fake provider for tests: records calls, sends nothing. */
export class RecordingProvider implements SmsProvider {
  readonly name = 'recording';
  readonly sent: { to: string; body: string }[] = [];

  async send(to: string, body: string): Promise<SmsSendResult> {
    this.sent.push({ to, body });
    return { status: 'sent', providerId: `rec_${this.sent.length}` };
  }
}

let override: SmsProvider | null = null;

/** Tests inject a RecordingProvider here; production reads SMS_PROVIDER. */
export function setSmsProvider(provider: SmsProvider | null) {
  override = provider;
}

export function getSmsProvider(): SmsProvider {
  if (override) return override;
  return env.SMS_PROVIDER === 'twilio' ? new TwilioProvider() : new ConsoleProvider();
}

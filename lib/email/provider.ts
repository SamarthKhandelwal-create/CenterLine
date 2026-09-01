import { env } from '@/lib/env';

export type EmailMessage = {
  to: string;
  subject: string;
  /** Always present. The plain-text part is the message; the HTML is a courtesy. */
  text: string;
  html?: string;
};

export type EmailSendResult =
  | { status: 'sent'; providerId: string | null }
  | { status: 'failed'; error: string };

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

/**
 * The default, and the reason a bare checkout can reset a password without an account
 * anywhere: it prints the message — reset link included — to the server terminal and
 * sends nothing. Every email path is exercised without a provider.
 */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';

  async send(message: EmailMessage): Promise<EmailSendResult> {
    console.log(
      `[email:console] -> ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n`,
    );
    return { status: 'sent', providerId: null };
  }
}

/**
 * Resend. Free tier is 3,000 messages a month / 100 a day, which is far more than a
 * centre resetting the occasional staff password will ever use.
 *
 * Setup is an API key and nothing else — `onboarding@resend.dev` is a shared sender
 * that works before any domain is verified, so the only blocker is that it can only
 * deliver to the address that owns the Resend account. Verifying a domain (a few DNS
 * records) lifts that and is the point at which `EMAIL_FROM` should change.
 *
 * Called over plain fetch rather than the SDK: it is one POST, and this keeps the
 * dependency list where it is.
 */
export class ResendProvider implements EmailProvider {
  readonly name = 'resend';

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const apiKey = env.RESEND_API_KEY;
    if (!apiKey) return { status: 'failed', error: 'resend_not_configured' };

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
        }),
      });

      if (!response.ok) {
        // Resend returns a JSON body with a `message`; fall back to the status if the
        // body is not JSON (a gateway error on the way, say).
        const detail = await response
          .json()
          .then((b: { message?: string }) => b.message)
          .catch(() => null);
        return {
          status: 'failed',
          error: `resend_${response.status}${detail ? `: ${detail.slice(0, 120)}` : ''}`,
        };
      }

      const body = (await response.json().catch(() => ({}))) as { id?: string };
      return { status: 'sent', providerId: body.id ?? null };
    } catch (err) {
      return { status: 'failed', error: (err as Error).message.slice(0, 120) };
    }
  }
}

/**
 * Any SMTP server, via a connection URL — a Gmail app password, Fastmail, the centre's
 * own mail host.
 *
 * This exists because of a real limit on Resend's shared sender: until a domain is
 * verified, `onboarding@resend.dev` only delivers to the address that owns the Resend
 * account. That is fine for trying the flow out and useless for resetting an
 * assistant's password. A Gmail app password is also free, needs no DNS, and delivers
 * to anybody:
 *
 *   SMTP_URL=smtps://you%40gmail.com:app-password@smtp.gmail.com:465
 *
 * Imported lazily so nodemailer never enters the Edge bundle.
 */
export class SmtpProvider implements EmailProvider {
  readonly name = 'smtp';

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const url = env.SMTP_URL;
    if (!url) return { status: 'failed', error: 'smtp_not_configured' };

    try {
      const { default: nodemailer } = await import('nodemailer');
      const transport = nodemailer.createTransport(url);
      const info = await transport.sendMail({
        from: env.EMAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      });
      return { status: 'sent', providerId: info.messageId ?? null };
    } catch (err) {
      return { status: 'failed', error: (err as Error).message.slice(0, 120) };
    }
  }
}

/** Fake provider for tests: records messages, sends nothing. */
export class RecordingEmailProvider implements EmailProvider {
  readonly name = 'recording';
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<EmailSendResult> {
    this.sent.push(message);
    return { status: 'sent', providerId: `rec_${this.sent.length}` };
  }

  get last(): EmailMessage | undefined {
    return this.sent[this.sent.length - 1];
  }
}

let override: EmailProvider | null = null;

/** Tests inject a RecordingEmailProvider here; production reads EMAIL_PROVIDER. */
export function setEmailProvider(provider: EmailProvider | null) {
  override = provider;
}

export function getEmailProvider(): EmailProvider {
  if (override) return override;
  if (env.EMAIL_PROVIDER === 'resend') return new ResendProvider();
  if (env.EMAIL_PROVIDER === 'smtp') return new SmtpProvider();
  return new ConsoleEmailProvider();
}

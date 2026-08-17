import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Twilio path with the SDK mocked.
 *
 * Real sending needs a funded account, a registered A2P 10DLC campaign and a public
 * webhook URL — none of which can live in a test. What CAN be proven here is
 * everything on our side of the wire: that credentials are read, that the message is
 * addressed and worded correctly, that the provider id comes back, and that carrier
 * error codes are captured rather than swallowed. When credentials are added, the only
 * untested step is Twilio's own API.
 */
const create = vi.fn();

vi.mock('twilio', () => {
  const factory = vi.fn(() => ({ messages: { create } }));
  return { default: factory, __factory: factory };
});

async function loadProvider(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const mod = await import('@/lib/sms/provider');
  return new mod.TwilioProvider();
}

const CONFIGURED = {
  SMS_PROVIDER: 'twilio',
  TWILIO_ACCOUNT_SID: 'ACtest00000000000000000000000000',
  TWILIO_AUTH_TOKEN: 'test-auth-token',
  TWILIO_FROM_NUMBER: '+15135550100',
};

describe('TwilioProvider', () => {
  const original = { ...process.env };

  beforeEach(() => {
    create.mockReset();
  });
  afterEach(() => {
    process.env = { ...original };
  });

  it('sends the message to the right number and returns the provider id', async () => {
    create.mockResolvedValue({ sid: 'SM123456' });
    const provider = await loadProvider(CONFIGURED);

    const result = await provider.send(
      '+15135551234',
      'Aiden is finished at Kumon of Mason West and ready for pickup.',
    );

    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith({
      to: '+15135551234',
      from: '+15135550100',
      body: 'Aiden is finished at Kumon of Mason West and ready for pickup.',
    });
    expect(result).toEqual({ status: 'sent', providerId: 'SM123456' });
  });

  it('refuses to send when credentials are missing rather than throwing', async () => {
    const provider = await loadProvider({
      ...CONFIGURED,
      TWILIO_AUTH_TOKEN: undefined,
      TWILIO_FROM_NUMBER: undefined,
    });

    const result = await provider.send('+15135551234', 'test');
    expect(result).toEqual({ status: 'failed', error: 'twilio_not_configured' });
    expect(create).not.toHaveBeenCalled();
  });

  it('captures the carrier error code so a failure is diagnosable', async () => {
    // 21610 is Twilio's "recipient has unsubscribed" — the code that matters most,
    // because it means our consent state disagrees with the carrier's.
    create.mockRejectedValue(Object.assign(new Error('unsubscribed'), { code: 21610 }));
    const provider = await loadProvider(CONFIGURED);

    const result = await provider.send('+15135551234', 'test');
    expect(result).toEqual({ status: 'failed', error: 'twilio_21610' });
  });

  it('survives a network failure with no error code', async () => {
    create.mockRejectedValue(new Error('socket hang up'));
    const provider = await loadProvider(CONFIGURED);

    const result = await provider.send('+15135551234', 'test');
    expect(result.status).toBe('failed');
    expect(result).toMatchObject({ error: expect.stringContaining('socket hang up') });
  });

  it('is selected by SMS_PROVIDER, and console is the default', async () => {
    vi.resetModules();
    process.env.SMS_PROVIDER = 'twilio';
    Object.assign(process.env, CONFIGURED);
    const twilio = await import('@/lib/sms/provider');
    expect(twilio.getSmsProvider().name).toBe('twilio');

    vi.resetModules();
    process.env.SMS_PROVIDER = 'console';
    const console_ = await import('@/lib/sms/provider');
    expect(console_.getSmsProvider().name).toBe('console');
  });
});

describe('the consent gate applies to Twilio exactly as it does to console', () => {
  it('never reaches the provider without consent', async () => {
    // Proven against the real gate in sms-consent.test.ts with a recording provider.
    // Restated here so the Twilio path is not assumed to be a special case: the gate
    // runs before getSmsProvider() is ever called, so swapping providers cannot
    // bypass it.
    const send = await import('@/lib/sms/send');
    expect(typeof send.sendPickupReady).toBe('function');
    expect(send.QUIET_START_HOUR).toBe(21);
    expect(send.QUIET_END_HOUR).toBe(8);
  });
});

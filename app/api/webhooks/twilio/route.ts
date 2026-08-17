import { NextResponse } from 'next/server';
import { grantConsentByPhone, revokeConsentByPhone } from '@/lib/sms/send';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STOP_WORDS = ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'revoke'];
const START_WORDS = ['start', 'unstop', 'yes'];

/**
 * Twilio inbound SMS. A STOP reply revokes consent immediately — before any reply is
 * generated, so the very next send is already blocked.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  const params = new URLSearchParams(raw);
  const from = params.get('From') ?? '';
  const body = (params.get('Body') ?? '').trim().toLowerCase();

  if (env.SMS_PROVIDER === 'twilio') {
    const signature = request.headers.get('x-twilio-signature');
    const url = env.TWILIO_WEBHOOK_URL;
    const token = env.TWILIO_AUTH_TOKEN;
    if (!signature || !url || !token) {
      return new NextResponse('forbidden', { status: 403 });
    }
    const { validateRequest } = await import('twilio');
    const fields = Object.fromEntries(params.entries());
    if (!validateRequest(token, signature, url, fields)) {
      return new NextResponse('forbidden', { status: 403 });
    }
  }

  if (!from) return new NextResponse('bad request', { status: 400 });

  let revoked = 0;
  if (STOP_WORDS.includes(body)) {
    revoked = await revokeConsentByPhone(from);
  } else if (START_WORDS.includes(body)) {
    await grantConsentByPhone(from, new Date());
  }

  console.log(`[twilio:webhook] ${from} "${body}" -> consent updated for ${revoked} guardian(s)`);
  return new NextResponse('<Response></Response>', {
    status: 200,
    headers: { 'content-type': 'text/xml' },
  });
}

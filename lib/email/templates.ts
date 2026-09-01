import type { EmailMessage } from './provider';

/** Kept in one place so the copy and the expiry text cannot drift apart. */
export const RESET_EXPIRY_MINUTES = 60;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The reset email.
 *
 * The link is written out in full in the text part rather than hidden behind anchor
 * text, because centre staff read this on a phone in a room full of children and a
 * bare URL survives being forwarded, copied, or read aloud. The HTML part is a
 * convenience; nothing depends on it rendering.
 */
export function passwordResetEmail(args: {
  to: string;
  name: string;
  centreName: string;
  resetUrl: string;
}): EmailMessage {
  const firstName = args.name.split(' ')[0] || args.name;

  const text = [
    `Hi ${firstName},`,
    '',
    `Someone asked to reset the password for your ${args.centreName} Centerline account (${args.to}).`,
    '',
    'Open this link to choose a new one:',
    args.resetUrl,
    '',
    `The link works once and expires in ${RESET_EXPIRY_MINUTES} minutes.`,
    '',
    'If this was not you, you can ignore this email — your password has not changed.',
  ].join('\n');

  const html = [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#0f172a">',
    `<p>Hi ${escapeHtml(firstName)},</p>`,
    `<p>Someone asked to reset the password for your ${escapeHtml(args.centreName)} Centerline account (${escapeHtml(args.to)}).</p>`,
    `<p><a href="${escapeHtml(args.resetUrl)}" style="display:inline-block;padding:10px 18px;border-radius:6px;background:#0f172a;color:#fff;text-decoration:none;font-weight:600">Choose a new password</a></p>`,
    `<p style="color:#475569;font-size:13px">Or paste this into your browser:<br><span style="word-break:break-all">${escapeHtml(args.resetUrl)}</span></p>`,
    `<p style="color:#475569;font-size:13px">The link works once and expires in ${RESET_EXPIRY_MINUTES} minutes. If this was not you, ignore this email — your password has not changed.</p>`,
    '</div>',
  ].join('');

  return {
    to: args.to,
    subject: `Reset your ${args.centreName} Centerline password`,
    text,
    html,
  };
}

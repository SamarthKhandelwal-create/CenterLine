/**
 * No emoji anywhere. A single emoji pushes the message from GSM-7 into UCS-2
 * encoding, which halves the characters per segment and doubles the bill.
 */

export const SAVED_TEMPLATES = [
  {
    id: 'running_late',
    label: 'Running late',
    body: 'This is {centre_name}. {first_name} is still working and will be a little longer than usual.',
  },
  {
    id: 'please_call',
    label: 'Please call us',
    body: 'This is {centre_name}. Could you give us a call when you have a moment?',
  },
  {
    id: 'forgot_materials',
    label: 'Forgot materials',
    body: 'This is {centre_name}. {first_name} did not bring their worksheets today.',
  },
] as const;

export function pickupReadyBody(firstNames: string[], centreName: string): string {
  const names = formatNameList(firstNames);
  const verb = firstNames.length > 1 ? 'are' : 'is';
  return `${names} ${verb} finished at ${centreName} and ready for pickup.`;
}

export function notArrivedBody(firstName: string, centreName: string): string {
  return `We haven't seen ${firstName} at ${centreName} today. Let us know if plans changed.`;
}

export function formatNameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function fillTemplate(
  body: string,
  vars: { first_name?: string; centre_name?: string },
): string {
  return body
    .replaceAll('{first_name}', vars.first_name ?? '')
    .replaceAll('{centre_name}', vars.centre_name ?? '')
    .trim();
}

/** Strips emoji and other non-GSM-7 characters so a message stays one segment. */
export function stripNonGsm(body: string): string {
  return body
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/gu, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

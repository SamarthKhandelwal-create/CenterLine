import { z } from 'zod';

/**
 * FormData.get() returns null for an absent field, and Zod treats null and undefined
 * as different things — so `z.string().optional()` rejects an omitted input rather
 * than skipping it. Every form field in this app goes through these helpers.
 */

/** An optional text field: absent or empty becomes undefined. */
export function optionalText(max = 500) {
  return z.preprocess(
    (v) => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined),
    z.string().max(max).optional(),
  );
}

/** A required text field with a friendly message. */
export function requiredText(message: string, max = 500) {
  return z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.string().min(1, message).max(max),
  );
}

/** An HTML checkbox: present ("on"/"true") is true, absent is false. */
export function checkbox() {
  return z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());
}

/** A number field that tolerates empty strings. */
export function optionalNumber() {
  return z.preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : undefined),
    z.number().int().optional(),
  );
}

/** Comma- or newline-separated list into a deduped, trimmed array. */
export function textList() {
  return z.preprocess(
    (v) =>
      typeof v === 'string'
        ? Array.from(
            new Set(
              v
                .split(/[,\n]/)
                .map((s) => s.trim())
                .filter(Boolean),
            ),
          )
        : [],
    z.array(z.string().max(60)).max(20),
  );
}

/** Returns the first validation message, for display on a form. */
export function firstIssue(error: z.ZodError, fallback = 'Check the form and try again.'): string {
  return error.issues[0]?.message ?? fallback;
}

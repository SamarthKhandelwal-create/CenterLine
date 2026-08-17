const SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v']);

export type SplitName = { firstName: string; lastName: string };

/**
 * Splits a name field. Handles "Last, First" (the common export shape), plain
 * "First Last", multi-word first names, and trailing suffixes.
 */
export function splitName(raw: string): SplitName {
  const value = raw.replace(/\s+/g, ' ').trim();
  if (!value) return { firstName: '', lastName: '' };

  if (value.includes(',')) {
    const [lastPart = '', firstPart = ''] = value.split(',', 2);
    return {
      firstName: titleCase(stripSuffix(firstPart.trim())),
      lastName: titleCase(stripSuffix(lastPart.trim())),
    };
  }

  const parts = stripSuffix(value).split(' ').filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: titleCase(parts[0]!), lastName: '' };

  // "Mary Jane Watson" -> first "Mary Jane", last "Watson".
  return {
    firstName: titleCase(parts.slice(0, -1).join(' ')),
    lastName: titleCase(parts[parts.length - 1]!),
  };
}

function stripSuffix(value: string): string {
  const parts = value.split(' ').filter(Boolean);
  while (parts.length > 1 && SUFFIXES.has(parts[parts.length - 1]!.toLowerCase())) parts.pop();
  return parts.join(' ');
}

/** Leaves already-mixed-case names alone so "deVries" and "McRae" survive. */
export function titleCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const hasInternalCaps = /[a-z][A-Z]/.test(trimmed) || /^[a-z]+[A-Z]/.test(trimmed);
  if (hasInternalCaps) return trimmed;
  if (trimmed !== trimmed.toUpperCase() && trimmed !== trimmed.toLowerCase()) return trimmed;

  return trimmed
    .toLowerCase()
    .split(/([ \-'])/)
    .map((part) => {
      if (part.length <= 1 && /[ \-']/.test(part)) return part;
      if (part.startsWith('mc') && part.length > 2) return `Mc${part[2]!.toUpperCase()}${part.slice(3)}`;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join('');
}

export function lastInitialOf(lastName: string): string {
  const match = /[a-z]/i.exec(lastName);
  return match ? match[0].toUpperCase() : '';
}

const SUBJECT_CANON: Record<string, string> = {
  math: 'Math',
  maths: 'Math',
  mathematics: 'Math',
  reading: 'Reading',
  english: 'Reading',
  'english reading': 'Reading',
  japanese: 'Japanese',
};

export function canonicalSubject(raw: string): string {
  const key = raw.toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!key) return '';
  return SUBJECT_CANON[key] ?? titleCase(raw.trim());
}

/**
 * To E.164 where possible. A 10-digit number is assumed to be the centre's country
 * (North America in practice); anything already in international form is preserved.
 */
export function normalizePhone(raw: string, defaultCountryCode = '1'): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('+')) return `+${trimmed.slice(1).replace(/\D/g, '')}`;

  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+${defaultCountryCode}${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

export function normalizeStatus(raw: string): 'active' | 'inactive' {
  const v = raw.toLowerCase().trim();
  if (['inactive', 'no', 'n', 'false', '0', 'withdrawn', 'left', 'archived'].includes(v)) {
    return 'inactive';
  }
  return 'active';
}

export function normalizeReleaseMode(raw: string): 'guardian_pickup' | 'self_release' | null {
  const v = raw.toLowerCase().trim();
  if (!v) return null;
  if (v.includes('self') || v.includes('walk') || v.includes('own')) return 'self_release';
  if (v.includes('guardian') || v.includes('parent') || v.includes('pick')) return 'guardian_pickup';
  return null;
}

/** The key used to match a file row to an existing student across imports. */
export function fullNameKey(firstName: string, lastName: string): string {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return `${clean(lastName)}|${clean(firstName)}`;
}

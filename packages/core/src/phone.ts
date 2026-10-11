/** Normalize a US-centric phone string or iMessage handle to E.164; returns null if it isn't a phone number. */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  // iMessage handles can be emails; those never match the allowlist.
  if (trimmed.includes('@')) return null;
  const digits = trimmed.replace(/[^\d]/g, '');
  if (trimmed.startsWith('+') && digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export function parseAllowlist(csv: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const part of (csv ?? '').split(',')) {
    const n = normalizePhone(part);
    if (n) out.add(n);
  }
  return out;
}

export function isAllowlisted(handle: string, allowlist: Set<string>): boolean {
  const n = normalizePhone(handle);
  return n !== null && allowlist.has(n);
}

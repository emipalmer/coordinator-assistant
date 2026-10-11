import { createHmac, timingSafeEqual } from 'node:crypto';

// Dashboard links go out by iMessage, so they carry their own expiring signature instead of a login.

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function signLink(secret: string, subject: string, expiresAt: Date): string {
  const payload = b64url(JSON.stringify({ s: subject, e: expiresAt.getTime() }));
  const sig = b64url(createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${sig}`;
}

/** Returns the subject (coordinator number) if the token is authentic and unexpired. */
export function verifyLink(secret: string, token: string | undefined, now = Date.now()): string | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { s, e } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { s: string; e: number };
    return typeof s === 'string' && typeof e === 'number' && e > now ? s : null;
  } catch {
    return null;
  }
}

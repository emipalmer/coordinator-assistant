import { createHmac, timingSafeEqual } from 'node:crypto';

// Requests from the Mac bridge are signed so API Gateway can't be driven by anyone who finds the URL.
export const SIGNATURE_HEADER = 'x-bridge-signature';
export const TIMESTAMP_HEADER = 'x-bridge-timestamp';
const MAX_SKEW_MS = 5 * 60 * 1000;

export function sign(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function verify(
  secret: string,
  timestamp: string | undefined,
  signature: string | undefined,
  body: string,
  now: number = Date.now(),
): boolean {
  if (!timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_SKEW_MS) return false;
  const expected = Buffer.from(sign(secret, timestamp, body), 'hex');
  const given = Buffer.from(signature, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

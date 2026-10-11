import { describe, expect, it } from 'vitest';
import { sign, verify } from './signing.js';

describe('request signing', () => {
  const now = 1_700_000_000_000;
  const ts = String(now);
  const sig = sign('s3cret', ts, '{"a":1}');

  it('verifies a fresh, untampered request', () => {
    expect(verify('s3cret', ts, sig, '{"a":1}', now)).toBe(true);
  });
  it('rejects a tampered body, wrong secret, or stale timestamp', () => {
    expect(verify('s3cret', ts, sig, '{"a":2}', now)).toBe(false);
    expect(verify('other', ts, sig, '{"a":1}', now)).toBe(false);
    expect(verify('s3cret', ts, sig, '{"a":1}', now + 10 * 60_000)).toBe(false);
  });
  it('rejects missing headers', () => {
    expect(verify('s3cret', undefined, sig, '{}', now)).toBe(false);
  });
});

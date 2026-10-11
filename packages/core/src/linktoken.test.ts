import { describe, expect, it } from 'vitest';
import { signLink, verifyLink } from './linktoken.js';

describe('dashboard link tokens', () => {
  const exp = new Date('2026-11-10T00:00:00Z');
  const now = new Date('2026-10-11T00:00:00Z').getTime();
  const t = signLink('secret', '+16105550100', exp);
  it('round-trips the subject', () => expect(verifyLink('secret', t, now)).toBe('+16105550100'));
  it('rejects expired, tampered, or foreign tokens', () => {
    expect(verifyLink('secret', t, exp.getTime() + 1)).toBeNull();
    expect(verifyLink('other', t, now)).toBeNull();
    const [p, s] = t.split('.');
    expect(verifyLink('secret', `${p}x.${s}`, now)).toBeNull();
    expect(verifyLink('secret', 'garbage', now)).toBeNull();
    expect(verifyLink('secret', undefined, now)).toBeNull();
  });
});

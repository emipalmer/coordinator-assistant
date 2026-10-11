import { describe, expect, it } from 'vitest';
import { pickLapsed } from './retention.js';

const now = new Date('2026-10-11T12:00:00Z');
const ago = (d: number) => new Date(now.getTime() - d * 86_400_000);

describe('pickLapsed', () => {
  it('picks people away 45+ days, most recently lapsed first', () => {
    const r = pickLapsed([
      { name: 'recent', status: 'active', lastActiveAt: ago(10) },
      { name: 'long', status: 'inactive', lastActiveAt: ago(120) },
      { name: 'lapsed', status: 'active', lastActiveAt: ago(50) },
    ], now);
    expect(r.map((x) => x.person.name)).toEqual(['lapsed', 'long']);
  });
  it('skips onboarding volunteers and anyone never active', () => {
    expect(pickLapsed([{ status: 'onboarding', lastActiveAt: ago(100) }, { status: 'active' }], now)).toEqual([]);
  });
  it('respects the check-in cooldown', () => {
    const p = { status: 'active', lastActiveAt: ago(60), lastCheckInDraftAt: ago(5) };
    expect(pickLapsed([p], now)).toEqual([]);
    expect(pickLapsed([{ ...p, lastCheckInDraftAt: ago(31) }], now)).toHaveLength(1);
  });
});

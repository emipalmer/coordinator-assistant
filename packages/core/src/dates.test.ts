import { describe, expect, it } from 'vitest';
import { localDate, localToUtc } from './dates.js';

const NY = 'America/New_York';

describe('localToUtc', () => {
  it('handles EDT and EST', () => {
    expect(localToUtc('2026-10-17T09:00', NY).toISOString()).toBe('2026-10-17T13:00:00.000Z');
    expect(localToUtc('2026-12-05T09:00', NY).toISOString()).toBe('2026-12-05T14:00:00.000Z');
  });
  it('handles the day DST ends', () => {
    expect(localToUtc('2026-11-01T12:00', NY).toISOString()).toBe('2026-11-01T17:00:00.000Z');
  });
  it('rejects malformed input', () => {
    expect(() => localToUtc('next saturday', NY)).toThrow();
  });
});

describe('localDate', () => {
  it('uses the local calendar day, not UTC', () => {
    // 11:30pm Oct 11 in New York is already Oct 12 in UTC.
    expect(localDate(new Date('2026-10-12T03:30:00Z'), NY)).toBe('2026-10-11');
  });
});

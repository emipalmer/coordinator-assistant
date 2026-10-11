import { describe, expect, it } from 'vitest';
import { daysSince, localDate, localToUtc, upcomingBirthdays } from './dates.js';

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

describe('upcomingBirthdays', () => {
  const now = new Date('2026-10-11T16:00:00Z');
  const people = [
    { name: 'today', birthday: { month: 10, day: 11 } },
    { name: 'soon', birthday: { month: 10, day: 15 } },
    { name: 'passed', birthday: { month: 10, day: 1 } },
    { name: 'none' },
  ];
  it('includes today and the window, soonest first', () => {
    const r = upcomingBirthdays(people, now, NY, 7);
    expect(r.map((x) => [x.person.name, x.inDays])).toEqual([['today', 0], ['soon', 4]]);
  });
  it('wraps into next year', () => {
    const r = upcomingBirthdays([{ birthday: { month: 1, day: 2 } }], new Date('2026-12-30T15:00:00Z'), NY, 7);
    expect(r[0]).toMatchObject({ date: '2027-01-02', inDays: 3 });
  });
  it('celebrates Feb 29 on Feb 28 in non-leap years', () => {
    const r = upcomingBirthdays([{ birthday: { month: 2, day: 29 } }], new Date('2027-02-25T15:00:00Z'), NY, 7);
    expect(r[0]?.date).toBe('2027-02-28');
  });
});

describe('daysSince', () => {
  it('counts whole days, null when never active', () => {
    expect(daysSince(new Date('2026-09-01T00:00:00Z'), new Date('2026-10-11T00:00:00Z'))).toBe(40);
    expect(daysSince(undefined, new Date())).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { alignToDays, rrule } from './calendar.js';

const NY = 'America/New_York';

describe('rrule', () => {
  it('weekly class until the last day of classes (UTC end of that local day)', () => {
    expect(rrule({ every: 'week', interval: 1, days: ['MO', 'WE', 'FR'], until: '2026-12-11' }, true, NY)).toBe('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261212T045959Z');
  });
  it('all-day and interval/count forms', () => {
    expect(rrule({ every: 'week', interval: 2, until: '2026-12-11' }, false, NY)).toBe('RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20261211');
    expect(rrule({ every: 'day', interval: 1, count: 5 }, true, NY)).toBe('RRULE:FREQ=DAILY;COUNT=5');
  });
});

describe('alignToDays', () => {
  it('moves the first occurrence onto a repeat day', () => {
    // Tue Nov 10 2026 -> next MO/WE/FR is Wed (+1)
    expect(alignToDays('2026-11-10T10:10', ['MO', 'WE', 'FR'])).toBe(1);
    expect(alignToDays('2026-11-11T10:10', ['MO', 'WE', 'FR'])).toBe(0);
    expect(alignToDays('2026-11-10T10:10', undefined)).toBe(0);
  });
});

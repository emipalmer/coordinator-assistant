import { describe, expect, it } from 'vitest';
import { categoryForColor, freeSlots, isQuiet, nextOccurrence, nudgesDue, nudgeTimes, planDrops } from './schedule.js';
import { formatLocal, localToUtc } from './dates.js';

const NY = 'America/New_York';
const at = (local: string) => localToUtc(local, NY);
const fmt = (d: Date) => formatLocal(d, NY);

describe('isQuiet', () => {
  it('wraps midnight (23:00-08:00)', () => {
    expect(isQuiet(at('2026-11-10T22:59'), NY)).toBe(false);
    expect(isQuiet(at('2026-11-10T23:00'), NY)).toBe(true);
    expect(isQuiet(at('2026-11-11T03:00'), NY)).toBe(true);
    expect(isQuiet(at('2026-11-11T08:00'), NY)).toBe(false);
  });
});

describe('deadline nudges', () => {
  const hw = { due: at('2026-11-12T23:59'), allDay: false, date: '2026-11-12' };

  it('fires 8pm the night before and 3 hours before', () => {
    const t = nudgeTimes(hw, NY);
    expect(fmt(t.night!)).toBe('Wed, Nov 11, 8:00 PM');
    expect(fmt(t.soon!)).toBe('Thu, Nov 12, 8:59 PM');
  });

  it('only sends what is due now and not already sent', () => {
    expect(nudgesDue(hw, {}, at('2026-11-11T19:59'), NY)).toEqual([]);
    expect(nudgesDue(hw, {}, at('2026-11-11T20:00'), NY)).toEqual(['night']);
    expect(nudgesDue(hw, { night: true }, at('2026-11-11T20:30'), NY)).toEqual([]);
    expect(nudgesDue(hw, { night: true }, at('2026-11-12T21:00'), NY)).toEqual(['soon']);
  });

  it('drops a nudge whose time fell in quiet hours instead of sending it late', () => {
    const early = { due: at('2026-11-12T09:00'), allDay: false, date: '2026-11-12' }; // 3h before = 6am
    expect(nudgesDue(early, { night: true }, at('2026-11-12T06:00'), NY)).toEqual([]);
    expect(nudgesDue(early, { night: true }, at('2026-11-12T08:00'), NY)).toEqual([]); // past the 2h grace
  });

  it('sends one text, not two, when the deadline is just after midnight', () => {
    const t = nudgeTimes({ due: at('2026-11-12T00:30'), allDay: false, date: '2026-11-12' }, NY);
    expect(t.night).toBeUndefined();
    expect(fmt(t.soon!)).toBe('Wed, Nov 11, 9:30 PM');
  });

  it('all-day items only get the night-before nudge', () => {
    const t = nudgeTimes({ due: at('2026-11-13'), allDay: true, date: '2026-11-12' }, NY);
    expect(Object.keys(t)).toEqual(['night']);
  });
});

describe('nextOccurrence', () => {
  it('keeps the wall-clock time across DST', () => {
    // DST ends Sun Nov 1 2026.
    expect(fmt(nextOccurrence(at('2026-10-31T09:00'), 'daily', NY, at('2026-10-31T09:01')))).toBe('Sun, Nov 1, 9:00 AM');
  });
  it('skips weekends for weekdays and jumps a week for weekly', () => {
    expect(fmt(nextOccurrence(at('2026-11-13T07:30'), 'weekdays', NY, at('2026-11-13T07:31')))).toBe('Mon, Nov 16, 7:30 AM');
    expect(fmt(nextOccurrence(at('2026-11-15T18:00'), 'weekly', NY, at('2026-11-15T18:01')))).toBe('Sun, Nov 22, 6:00 PM');
  });
});

describe('freeSlots', () => {
  const base = {
    zone: NY,
    durationMin: 60,
    windowStart: '09:00',
    windowEnd: '21:00',
    bufferMin: 15,
    notBefore: at('2026-11-16T00:00'),
    count: 3,
  };

  it('works around busy blocks with a buffer and spreads across days', () => {
    const slots = freeSlots({
      ...base,
      from: '2026-11-16',
      to: '2026-11-18',
      busy: [{ start: at('2026-11-16T09:00'), end: at('2026-11-16T11:00') }],
    });
    expect(slots.map(({ start }) => fmt(start))).toEqual(['Mon, Nov 16, 11:30 AM', 'Tue, Nov 17, 9:00 AM', 'Wed, Nov 18, 9:00 AM']);
  });

  it('honours a preferred time, weekdays-only, and notBefore', () => {
    const slots = freeSlots({ ...base, from: '2026-11-13', to: '2026-11-16', busy: [], prefer: '15:00', weekdaysOnly: true, notBefore: at('2026-11-13T16:00') });
    expect(slots.map(({ start }) => fmt(start))).toEqual(['Fri, Nov 13, 4:00 PM', 'Fri, Nov 13, 6:00 PM', 'Mon, Nov 16, 3:00 PM']);
  });

  it('returns nothing when the day is booked', () => {
    expect(freeSlots({ ...base, from: '2026-11-16', to: '2026-11-16', busy: [{ start: at('2026-11-16T08:00'), end: at('2026-11-16T22:00') }] })).toEqual([]);
  });
});

describe('categories', () => {
  it('maps colorId back to a category', () => {
    expect(categoryForColor('11')).toBe('due');
    expect(categoryForColor(undefined)).toBeUndefined();
  });
});

describe('capybara drops', () => {
  it('spreads n drops through 10am-9pm', () => {
    let i = 0;
    const rand = () => [0, 0.5, 0.99][i++ % 3]!;
    const times = planDrops('2026-11-23', 3, NY, at('2026-11-23T07:00'), rand);
    expect(times.map(fmt)).toEqual(['Mon, Nov 23, 10:00 AM', 'Mon, Nov 23, 3:08 PM', 'Mon, Nov 23, 8:14 PM']);
  });

  it('only uses what is left of the day', () => {
    const times = planDrops('2026-11-23', 3, NY, at('2026-11-23T20:00'), () => 0.5);
    expect(times).toHaveLength(1);
    expect(times[0]! >= at('2026-11-23T20:05') && times[0]! < at('2026-11-23T21:00')).toBe(true);
    expect(planDrops('2026-11-23', 3, NY, at('2026-11-23T21:30'))).toEqual([]);
    expect(planDrops('2026-11-23', 0, NY, at('2026-11-23T07:00'))).toEqual([]);
  });
});

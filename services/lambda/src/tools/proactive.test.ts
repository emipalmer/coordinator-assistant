import { describe, expect, it } from 'vitest';
import { shiftSlot } from './proactive.js';

describe('shiftSlot', () => {
  it('uses local day and part of day', () => {
    // 13:00Z on Sat Oct 17 is 9am in New York
    expect(shiftSlot(new Date('2026-10-17T13:00:00Z'), 'America/New_York')).toEqual({ day: 'sat', part: 'morning' });
    // 01:00Z Thursday is 9pm Wednesday in New York
    expect(shiftSlot(new Date('2026-10-15T01:00:00Z'), 'America/New_York')).toEqual({ day: 'wed', part: 'evening' });
  });
});

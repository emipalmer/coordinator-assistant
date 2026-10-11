import { describe, expect, it } from 'vitest';
import { buildIcs, escapeText, fold } from './ics.js';

describe('buildIcs', () => {
  const ics = buildIcs({
    uid: 'shift-abc@coordinator-assistant',
    start: new Date('2026-10-17T13:00:00Z'),
    end: new Date('2026-10-17T17:00:00Z'),
    title: 'Saturday Pantry',
    location: 'Main hall, 12 Maple St',
    description: 'Unload the truck; sort, and distribute.\nBring gloves.',
    stamp: new Date('2026-10-11T20:00:00Z'),
  });
  it('writes UTC times and CRLF line endings', () => {
    expect(ics).toContain('DTSTART:20261017T130000Z\r\n');
    expect(ics).toContain('DTEND:20261017T170000Z\r\n');
    expect(ics.split('\r\n').every((l) => !l.includes('\n'))).toBe(true);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
  it('escapes special characters', () => {
    expect(ics).toContain('LOCATION:Main hall\\, 12 Maple St');
    expect(escapeText('a;b,c\nd\\')).toBe('a\;b\\,c\\nd\\\\');
  });
  it('folds long lines at 75 octets', () => {
    const folded = fold(`DESCRIPTION:${'x'.repeat(200)}`);
    for (const line of folded.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe(`DESCRIPTION:${'x'.repeat(200)}`);
  });
});

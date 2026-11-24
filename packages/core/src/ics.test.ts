import { describe, expect, it } from 'vitest';
import { parseIcs } from './ics.js';

const NY = 'America/New_York';

// Shaped like a Canvas Calendar Feed (CRLF, folded lines, escapes).
const FEED = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Instructure//Canvas//EN',
  'BEGIN:VEVENT',
  'DTSTAMP:20261101T120000Z',
  'DTSTART:20261113T045900Z',
  'DTEND:20261113T045900Z',
  'SUMMARY:Homework 5 [STAT_200_001_FA26]',
  'UID:event-assignment-456',
  'URL;VALUE=URI:https://psu.instructure.com/calendar?include_contexts=course_1#assignment_456',
  'DESCRIPTION:Problems 1-10\\, show work.\\nSubmit as one PDF; no',
  '  late work.',
  'BEGIN:VALARM',
  'DESCRIPTION:Reminder',
  'END:VALARM',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261120',
  'DTEND;VALUE=DATE:20261121',
  'SUMMARY:Reading quiz [ENGL_15]',
  'UID:event-assignment-789',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=America/Chicago:20261118T140000',
  'DTEND;TZID=America/Chicago:20261118T150000',
  'SUMMARY:Office hours',
  'LOCATION:Thomas 102',
  'UID:event-calendar-event-12',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'SUMMARY:No start, skipped',
  'UID:broken',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('parseIcs', () => {
  const events = parseIcs(FEED, NY);

  it('reads every well-formed event and skips ones without a start', () => {
    expect(events.map((e) => e.uid)).toEqual(['event-assignment-456', 'event-assignment-789', 'event-calendar-event-12']);
  });

  it('parses UTC times, unfolds lines, unescapes text, and ignores VALARM fields', () => {
    const hw = events[0]!;
    expect(hw.allDay).toBe(false);
    expect(hw.start.toISOString()).toBe('2026-11-13T04:59:00.000Z');
    expect(hw.summary).toBe('Homework 5 [STAT_200_001_FA26]');
    expect(hw.description).toBe('Problems 1-10, show work.\nSubmit as one PDF; no late work.');
    expect(hw.url).toContain('assignment_456');
  });

  it('treats VALUE=DATE as all-day at local midnight', () => {
    const quiz = events[1]!;
    expect(quiz.allDay).toBe(true);
    expect(quiz.date).toBe('2026-11-20');
    expect(quiz.start.toISOString()).toBe('2026-11-20T05:00:00.000Z');
  });

  it('converts TZID wall times', () => {
    const oh = events[2]!;
    expect(oh.start.toISOString()).toBe('2026-11-18T20:00:00.000Z');
    expect(oh.end?.toISOString()).toBe('2026-11-18T21:00:00.000Z');
    expect(oh.location).toBe('Thomas 102');
  });
});

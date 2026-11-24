// Pure scheduling logic shared by the agent tools and the once-a-minute ticker: quiet hours,
// deadline nudge timing, repeating reminders, and free-slot search for "when can I meet?".
import { localDate, localToUtc } from './dates.js';

const DAY = 86_400_000;

/** Hour and minute of an instant in `zone`. */
export function localTime(at: Date, zone: string): { h: number; m: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(at).map((p) => [p.type, p.value]),
  );
  return { h: +parts.hour!, m: +parts.minute! };
}

export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** 0 = Sunday. */
export const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};

/** Quiet hours wrap midnight, e.g. 23:00-08:00. Assistant-initiated nudges hold off during them; reminders the owner set still go out. */
export const QUIET_HOURS = { start: '23:00', end: '08:00' } as const;

export function isQuiet(at: Date, zone: string, quiet: { start: string; end: string } = QUIET_HOURS): boolean {
  const { h, m } = localTime(at, zone);
  const now = h * 60 + m;
  const s = minutes(quiet.start);
  const e = minutes(quiet.end);
  return s <= e ? now >= s && now < e : now >= s || now < e;
}

// --- Deadline nudges ----------------------------------------------------------------------

export type NudgeKind = 'night' | 'soon';
export const NIGHT_BEFORE_AT = '20:00';
export const SOON_BEFORE_MS = 3 * 3_600_000;
/** A nudge that couldn't go out on time (quiet hours, outage) is dropped after this; the morning briefing covers it. */
export const NUDGE_GRACE_MS = 2 * 3_600_000;

export interface NudgeTarget {
  /** For timed items the due instant; for all-day items, the end of the due day. */
  due: Date;
  allDay: boolean;
  /** Local due date (YYYY-MM-DD). */
  date: string;
}

/** When each nudge for an item should fire: 8pm the night before, and 3 hours before (timed items only). */
export function nudgeTimes(t: NudgeTarget, zone: string): Partial<Record<NudgeKind, Date>> {
  const out: Partial<Record<NudgeKind, Date>> = {};
  const night = localToUtc(`${addDays(t.date, -1)}T${NIGHT_BEFORE_AT}`, zone);
  // If "3 hours before" comes within 6 hours of the night-before nudge (e.g. due at 12:30am), one text is enough.
  if (t.allDay || t.due.getTime() - night.getTime() > 6 * 3_600_000) out.night = night;
  if (!t.allDay) out.soon = new Date(t.due.getTime() - SOON_BEFORE_MS);
  return out;
}

/** Nudges that should go out now: their time has come (within the grace window), it isn't quiet hours, and the item isn't due yet. */
export function nudgesDue(t: NudgeTarget, sent: Partial<Record<NudgeKind, unknown>>, now: Date, zone: string): NudgeKind[] {
  if (t.due <= now || isQuiet(now, zone)) return [];
  const times = nudgeTimes(t, zone);
  return (Object.keys(times) as NudgeKind[]).filter((k) => !sent[k] && times[k]! <= now && now.getTime() - times[k]!.getTime() < NUDGE_GRACE_MS);
}

// --- Repeating reminders ------------------------------------------------------------------

export type Repeat = 'daily' | 'weekdays' | 'weekly';

/** Next time a repeating reminder fires, keeping the same local wall-clock time (DST-safe). Always after `now`. */
export function nextOccurrence(dueAt: Date, repeat: Repeat, zone: string, now: Date): Date {
  const { h, m } = localTime(dueAt, zone);
  const hhmm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  let day = localDate(dueAt, zone);
  for (let i = 0; i < 400; i++) {
    day = addDays(day, repeat === 'weekly' ? 7 : 1);
    if (repeat === 'weekdays' && (weekday(day) === 0 || weekday(day) === 6)) continue;
    const at = localToUtc(`${day}T${hhmm}`, zone);
    if (at > now) return at;
  }
  throw new Error('no next occurrence');
}

// --- Daily drops (capybara pics, pep talks) ----------------------------------------------------------------------

/** Random daily drops land inside these local windows, well clear of quiet hours. */
export const CAPY_WINDOW = { start: '10:00', end: '21:00' } as const;
export const PEP_WINDOW = { start: '09:30', end: '20:00' } as const;

/**
 * `n` random times on local `day`, one in each equal slice of what's left of the window after
 * `notBefore`, so they spread through the day instead of bunching up. Sorted; minute precision.
 */
export function planDrops(
  day: string,
  n: number,
  zone: string,
  notBefore: Date,
  rand: () => number = Math.random,
  window: { start: string; end: string } = CAPY_WINDOW,
): Date[] {
  const start = Math.max(localToUtc(`${day}T${window.start}`, zone).getTime(), notBefore.getTime() + 5 * 60_000);
  const end = localToUtc(`${day}T${window.end}`, zone).getTime();
  if (n <= 0 || start >= end) return [];
  // Short of time (planned late in the day): fewer drops, at least 30 minutes apart.
  const count = Math.min(n, Math.max(1, Math.floor((end - start) / (30 * 60_000))));
  const slice = (end - start) / count;
  return Array.from({ length: count }, (_, i) => {
    const t = start + slice * i + rand() * slice * 0.8;
    return new Date(Math.floor(t / 60_000) * 60_000);
  });
}

// --- Free time ----------------------------------------------------------------------------

export interface Interval {
  start: Date;
  end: Date;
}

export interface SlotQuery {
  /** Local dates to search, inclusive. */
  from: string;
  to: string;
  zone: string;
  busy: Interval[];
  durationMin: number;
  /** Daily window, local "HH:mm" (the owner's usual day, narrowed by the request). */
  windowStart: string;
  windowEnd: string;
  /** Kept clear before and after existing commitments. */
  bufferMin: number;
  /** Nothing earlier than this (e.g. an hour from now). */
  notBefore: Date;
  weekdaysOnly?: boolean;
  /** Preferred local start time; picks the open slot closest to it each day. Defaults to the earliest. */
  prefer?: string;
  count: number;
}

const STEP_MIN = 30;

/** Up to `count` open slots, spread across different days first, then a second option on the same days. */
export function freeSlots(q: SlotQuery): Interval[] {
  const dur = q.durationMin * 60_000;
  const buf = q.bufferMin * 60_000;
  const busy = q.busy.map((b) => ({ s: b.start.getTime() - buf, e: b.end.getTime() + buf }));
  const perDay: Interval[][] = [];
  for (let day = q.from; day <= q.to; day = addDays(day, 1)) {
    if (q.weekdaysOnly && (weekday(day) === 0 || weekday(day) === 6)) continue;
    const open = localToUtc(`${day}T${q.windowStart}`, q.zone).getTime();
    const close = localToUtc(`${day}T${q.windowEnd}`, q.zone).getTime();
    const cands: Interval[] = [];
    for (let s = open; s + dur <= close; s += STEP_MIN * 60_000) {
      if (s < q.notBefore.getTime()) continue;
      const e = s + dur;
      if (busy.some((b) => s < b.e && e > b.s)) continue;
      cands.push({ start: new Date(s), end: new Date(e) });
    }
    if (q.prefer) {
      const target = minutes(q.prefer);
      const dist = (c: Interval) => {
        const { h, m } = localTime(c.start, q.zone);
        return Math.abs(h * 60 + m - target);
      };
      cands.sort((a, b) => dist(a) - dist(b) || a.start.getTime() - b.start.getTime());
    }
    if (cands.length) perDay.push(cands);
  }
  const picked: Interval[] = perDay.map((c) => c[0]!).slice(0, q.count);
  // Fewer days than requested: add a second option per day, at least 2 hours from the first.
  for (const cands of perDay) {
    if (picked.length >= q.count) break;
    const first = cands[0]!;
    const second = cands.find((c) => Math.abs(c.start.getTime() - first.start.getTime()) >= 2 * 3_600_000);
    if (second) picked.push(second);
  }
  return picked.sort((a, b) => a.start.getTime() - b.start.getTime());
}

// --- Calendar categories ------------------------------------------------------------------

/** Event categories and their Google Calendar colorId. */
export const EVENT_CATEGORIES = {
  class: { colorId: '9', color: 'Blueberry' },
  study: { colorId: '2', color: 'Sage' },
  due: { colorId: '11', color: 'Tomato' },
  exam: { colorId: '4', color: 'Flamingo' },
  work: { colorId: '6', color: 'Tangerine' },
  meeting: { colorId: '7', color: 'Peacock' },
  social: { colorId: '3', color: 'Grape' },
  appointment: { colorId: '5', color: 'Banana' },
  fitness: { colorId: '10', color: 'Basil' },
  travel: { colorId: '8', color: 'Graphite' },
  personal: { colorId: '1', color: 'Lavender' },
} as const;
export type EventCategory = keyof typeof EVENT_CATEGORIES;
export const CATEGORY_NAMES = Object.keys(EVENT_CATEGORIES) as [EventCategory, ...EventCategory[]];
export const categoryForColor = (colorId?: string) => CATEGORY_NAMES.find((c) => EVENT_CATEGORIES[c].colorId === colorId);

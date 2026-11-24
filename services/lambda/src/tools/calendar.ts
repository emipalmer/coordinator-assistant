import { z } from 'zod';
import {
  addDays, CATEGORY_NAMES, categoryForColor, DEFAULT_DAY, EVENT_CATEGORIES, formatLocal, freeSlots, localDate, localTime, localToUtc, truncate, weekday,
  type EventCategory, type Interval,
} from '@app/core';
import { googleApi } from '../google.js';
import { defineTool, type ToolContext } from './registry.js';
import { withGoogle } from './google.js';

const CAL = 'https://www.googleapis.com/calendar/v3';
const LocalDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** "YYYY-MM-DD" for an all-day event, or "YYYY-MM-DDTHH:mm" local time. */
const LocalWhen = z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/);
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const Category = z.enum(CATEGORY_NAMES).describe(`Always set one: ${CATEGORY_NAMES.join(', ')}. It sets the event color and which calendar it goes on.`);
const ReminderMinutes = z.array(z.number().int().min(0).max(40320)).max(5);
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
const Repeat = z.object({
  every: z.enum(['day', 'week', 'month']),
  interval: z.number().int().min(1).max(4).default(1).describe('2 = every other week, etc.'),
  days: z.array(z.enum(DAYS)).min(1).max(7).optional().describe('For weekly: which days, e.g. ["MO","WE","FR"]'),
  until: LocalDay.optional().describe('Last date it can happen (e.g. the last day of classes)'),
  count: z.number().int().min(1).max(200).optional(),
});
type Repeat = z.infer<typeof Repeat>;

interface CalendarListEntry { id: string; summary: string; summaryOverride?: string; primary?: boolean; selected?: boolean; hidden?: boolean; accessRole: string }
interface GEvent {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  description?: string;
  htmlLink?: string;
  hangoutLink?: string;
  colorId?: string;
  transparency?: 'opaque' | 'transparent';
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
  recurringEventId?: string;
  recurrence?: string[];
}

const calendarList = (ctx: ToolContext) =>
  googleApi<{ items?: CalendarListEntry[] }>(ctx.c, ctx.owner, 'GET', `${CAL}/users/me/calendarList?maxResults=250`).then((r) => r.items ?? []);
const shownCalendars = async (ctx: ToolContext) => (await calendarList(ctx)).filter((c) => c.selected && !c.hidden);

const eventsUrl = (calendarId: string, eventId?: string) => `${CAL}/calendars/${encodeURIComponent(calendarId)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ''}`;

const profileOf = (ctx: ToolContext) => ctx.c.profiles.findOne({ _id: ctx.owner }, { projection: { prefs: 1 } });

/** Google's start/end shape for a local wall-clock time or an all-day date. */
function toGoogleTime(when: string, tz: string) {
  return when.includes('T') ? { dateTime: `${when}:00`, timeZone: tz } : { date: when };
}

/** Default end: one hour after a timed start, or the same single day for an all-day event (Google's end date is exclusive). */
function defaultEnd(start: string, tz: string) {
  if (!start.includes('T')) return { date: addDays(start, 1) };
  return { dateTime: toLocalWhen(new Date(localToUtc(start, tz).getTime() + 3_600_000), tz) + ':00', timeZone: tz };
}

/** Local "YYYY-MM-DDTHH:mm" for an instant. */
function toLocalWhen(at: Date, tz: string) {
  const { h, m } = localTime(at, tz);
  return `${localDate(at, tz)}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const reminders = (mins?: number[]) => (mins === undefined ? undefined : { useDefault: false, overrides: mins.map((minutes) => ({ method: 'popup', minutes })) });

/** RRULE for Google. Timed events need UNTIL in UTC; all-day events use a date. */
export function rrule(r: Repeat, timed: boolean, tz: string): string {
  const parts = [`FREQ=${({ day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY' } as const)[r.every]}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.every === 'week' && r.days?.length) parts.push(`BYDAY=${r.days.join(',')}`);
  if (r.until) parts.push(`UNTIL=${untilValue(r.until, timed, tz)}`);
  else if (r.count) parts.push(`COUNT=${r.count}`);
  return `RRULE:${parts.join(';')}`;
}
function untilValue(day: string, timed: boolean, tz: string) {
  if (!timed) return day.replace(/-/g, '');
  const endOfDay = new Date(localToUtc(addDays(day, 1), tz).getTime() - 1000);
  return endOfDay.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** With BYDAY, the first occurrence must itself be one of those days, or Google adds an extra one on the start date. */
export function alignToDays(start: string, days?: readonly string[]) {
  if (!days?.length) return 0;
  const date = start.slice(0, 10);
  for (let i = 0; i < 7; i++) if (days.includes(DAYS[weekday(addDays(date, i))]!)) return i;
  return 0;
}
const shiftWhen = (when: string, n: number) => (n ? addDays(when.slice(0, 10), n) + when.slice(10) : when);

function describeEvent(e: GEvent, ctx: ToolContext, calendar?: string) {
  const allDay = !!e.start.date;
  const lastDay = allDay && e.end.date ? addDays(e.end.date, -1) : undefined;
  const category = categoryForColor(e.colorId);
  return {
    id: e.id,
    ...(calendar && { calendar }),
    title: e.summary ?? '(no title)',
    start: allDay ? e.start.date : formatLocal(new Date(e.start.dateTime!), ctx.timezone),
    end: allDay ? (lastDay !== e.start.date ? lastDay : undefined) : formatLocal(new Date(e.end.dateTime!), ctx.timezone),
    ...(allDay && { allDay: true }),
    ...(category && { category }),
    ...(e.location && { location: e.location }),
    ...(e.hangoutLink && { meet: e.hangoutLink }),
    ...(e.description && { notes: truncate(e.description, 300) }),
    ...((e.recurringEventId || e.recurrence) && { recurring: true }),
    ...(e.transparency === 'transparent' && { showsAsFree: true }),
    ...(e.attendees?.find((a) => a.self)?.responseStatus === 'declined' && { declined: true }),
  };
}

interface Listed { ev: GEvent; calendarId: string; calendarName: string; startMs: number; endMs: number }

/** Expanded events across the shown calendars (or the given ones) between two instants. */
async function fetchEvents(ctx: ToolContext, timeMin: Date, timeMax: Date, opts: { calendarIds?: string[]; query?: string } = {}): Promise<Listed[]> {
  const all = await calendarList(ctx);
  const cals = opts.calendarIds?.length
    ? opts.calendarIds.map((id) => all.find((c) => c.id === id || (id === 'primary' && c.primary)) ?? { id, summary: id, accessRole: 'reader' })
    : all.filter((c) => c.selected && !c.hidden);
  const results = await Promise.all(
    cals.map(async (cal) => {
      const q = new URLSearchParams({ timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250', ...(opts.query && { q: opts.query }) });
      try {
        const r = await googleApi<{ items?: GEvent[] }>(ctx.c, ctx.owner, 'GET', `${eventsUrl(cal.id)}?${q}`);
        const name = (cal as CalendarListEntry).primary ? 'primary' : ((cal as CalendarListEntry).summaryOverride ?? cal.summary);
        return (r.items ?? [])
          .filter((e) => e.status !== 'cancelled')
          .map((ev) => ({
            ev,
            calendarId: cal.id,
            calendarName: name,
            startMs: ev.start.dateTime ? Date.parse(ev.start.dateTime) : localToUtc(ev.start.date!, ctx.timezone).getTime(),
            endMs: ev.end.dateTime ? Date.parse(ev.end.dateTime) : localToUtc(ev.end.date!, ctx.timezone).getTime(),
          }));
      } catch (err) {
        ctx.log.warn('calendar read failed', { err: (err as Error).message });
        return [];
      }
    }),
  );
  return results.flat().sort((a, b) => a.startMs - b.startMs);
}

/** Timed, busy, not-declined events: what actually occupies time. */
const occupies = (l: Listed) => !!l.ev.start.dateTime && l.ev.transparency !== 'transparent' && l.ev.attendees?.find((a) => a.self)?.responseStatus !== 'declined';

/** Hours covered by the union of intervals. */
function bookedHours(list: Listed[]) {
  let total = 0;
  let curS = -1;
  let curE = -1;
  for (const l of [...list].sort((a, b) => a.startMs - b.startMs)) {
    if (l.startMs > curE) {
      if (curE > curS) total += curE - curS;
      curS = l.startMs;
      curE = l.endMs;
    } else curE = Math.max(curE, l.endMs);
  }
  if (curE > curS) total += curE - curS;
  return Math.round((total / 3_600_000) * 10) / 10;
}

/** What else is on that day, so the model can flag clashes and overloaded days. */
async function dayCheck(ctx: ToolContext, created: GEvent) {
  if (!created.start.dateTime) return undefined;
  const s = Date.parse(created.start.dateTime);
  const e = Date.parse(created.end.dateTime!);
  const day = localDate(new Date(s), ctx.timezone);
  const events = (await fetchEvents(ctx, localToUtc(day, ctx.timezone), localToUtc(addDays(day, 1), ctx.timezone))).filter(occupies);
  const others = events.filter((l) => l.ev.id !== created.id && l.ev.recurringEventId !== created.id);
  const overlaps = others.filter((l) => l.startMs < e && l.endMs > s).map((l) => `${l.ev.summary ?? '(no title)'} ${formatLocal(new Date(l.startMs), ctx.timezone)}`);
  return { ...(overlaps.length && { overlaps }), thatDay: { events: events.length, bookedHours: bookedHours(events) } };
}

export const listCalendars = defineTool({
  name: 'list_calendars',
  description: "The owner's Google calendars (id, name, whether it's primary, whether it's shown, and if it can be edited).",
  input: z.object({}),
  async run(ctx) {
    return withGoogle(async () =>
      (await calendarList(ctx)).map((c) => ({ id: c.id, name: c.summaryOverride ?? c.summary, primary: c.primary || undefined, shown: !!c.selected && !c.hidden, editable: c.accessRole === 'owner' || c.accessRole === 'writer' })),
    );
  },
});

export const listEvents = defineTool({
  name: 'list_events',
  description:
    'Events between two local dates (inclusive), across every calendar the owner has shown in Google Calendar, or only the given calendarIds. Optional text search. Recurring events are expanded. Returns event ids for update_event/delete_event, plus booked hours per day.',
  input: z.object({
    from: LocalDay,
    to: LocalDay.optional().describe('Defaults to `from` (a single day)'),
    query: z.string().max(200).optional(),
    calendarIds: z.array(z.string().min(1)).max(20).optional(),
  }),
  async run(ctx, input) {
    return withGoogle(async () => {
      const to = input.to ?? input.from;
      const listed = await fetchEvents(ctx, localToUtc(input.from, ctx.timezone), localToUtc(addDays(to, 1), ctx.timezone), input);
      const events = listed.map((l) => ({ calendarId: l.calendarId, ...describeEvent(l.ev, ctx, l.calendarName) }));
      const perDay: Record<string, number> = {};
      for (let d = input.from; d <= to && Object.keys(perDay).length < 31; d = addDays(d, 1)) {
        const lo = localToUtc(d, ctx.timezone).getTime();
        const hi = localToUtc(addDays(d, 1), ctx.timezone).getTime();
        const h = bookedHours(listed.filter((l) => occupies(l) && l.startMs < hi && l.endMs > lo).map((l) => ({ ...l, startMs: Math.max(l.startMs, lo), endMs: Math.min(l.endMs, hi) })));
        if (h) perDay[d] = h;
      }
      return { from: input.from, to, events: events.slice(0, 150), bookedHoursByDay: perDay, ...(events.length > 150 && { note: 'More events exist; narrow the range.' }) };
    });
  },
});

export const createEvent = defineTool({
  name: 'create_event',
  description:
    'Add an event. Times are local: "YYYY-MM-DDTHH:mm", or "YYYY-MM-DD" for all-day. End defaults to 1 hour after start. Set a category (color + which calendar). Optional repeat (e.g. a class every MO/WE/FR until the last day of classes) and popup reminders. All-day and "due" events show as free so they don\'t block time. Result lists overlaps and how booked that day is. Never invites other people.',
  input: z.object({
    title: z.string().min(1).max(200),
    start: LocalWhen,
    end: LocalWhen.optional(),
    category: Category,
    calendarId: z.string().min(1).max(300).optional().describe('Only to override where the category normally goes'),
    location: z.string().max(300).optional(),
    notes: z.string().max(4000).optional(),
    reminderMinutes: ReminderMinutes.optional().describe('Popup reminders, minutes before (e.g. [1440, 120]). Omit for the calendar default.'),
    repeat: Repeat.optional(),
    showAs: z.enum(['busy', 'free']).optional(),
  }),
  async run(ctx, input) {
    if (input.end && input.start.includes('T') !== input.end.includes('T')) return { ok: false, content: 'start and end must both be timed or both be all-day dates.' };
    return withGoogle(async () => {
      const profile = await profileOf(ctx);
      const calendarId = input.calendarId ?? profile?.prefs?.calendarFor?.[input.category] ?? 'primary';
      const timed = input.start.includes('T');
      const shift = input.repeat?.every === 'week' ? alignToDays(input.start, input.repeat.days) : 0;
      const start = shiftWhen(input.start, shift);
      const end = input.end ? shiftWhen(input.end, shift) : undefined;
      const free = input.showAs ? input.showAs === 'free' : !timed || input.category === 'due';
      const ev = await googleApi<GEvent>(ctx.c, ctx.owner, 'POST', `${eventsUrl(calendarId)}?sendUpdates=none`, {
        summary: input.title,
        location: input.location,
        description: input.notes,
        colorId: EVENT_CATEGORIES[input.category as EventCategory].colorId,
        start: toGoogleTime(start, ctx.timezone),
        end: end ? toGoogleTime(end.includes('T') ? end : addDays(end, 1), ctx.timezone) : defaultEnd(start, ctx.timezone),
        transparency: free ? 'transparent' : 'opaque',
        ...(input.repeat && { recurrence: [rrule(input.repeat, timed, ctx.timezone)] }),
        ...(input.reminderMinutes && { reminders: reminders(input.reminderMinutes) }),
      });
      return { created: describeEvent(ev, ctx), calendarId, ...(shift && { note: `First occurrence moved to ${start.slice(0, 10)} to match the repeat days.` }), ...(await dayCheck(ctx, ev)) };
    });
  },
});

export const updateEvent = defineTool({
  name: 'update_event',
  description:
    'Change an existing event (only the fields given). Get eventId and calendarId from list_events. For a recurring event, applyTo "this" changes one occurrence; "series" changes every occurrence (a new start time keeps each occurrence\'s date). stopRepeatingAfter ends a series after a date (e.g. dropped a class).',
  input: z.object({
    eventId: z.string().min(1),
    calendarId: z.string().min(1).max(300).default('primary'),
    applyTo: z.enum(['this', 'series']).default('this'),
    title: z.string().min(1).max(200).optional(),
    start: LocalWhen.optional(),
    end: LocalWhen.optional(),
    category: Category.optional(),
    location: z.string().max(300).optional(),
    notes: z.string().max(4000).optional(),
    reminderMinutes: ReminderMinutes.optional(),
    showAs: z.enum(['busy', 'free']).optional(),
    stopRepeatingAfter: LocalDay.optional(),
  }),
  async run(ctx, input) {
    return withGoogle(async () => {
      const cur = await googleApi<GEvent>(ctx.c, ctx.owner, 'GET', eventsUrl(input.calendarId, input.eventId));
      const recurring = !!(cur.recurringEventId || cur.recurrence);
      if (input.stopRepeatingAfter && !recurring) return { error: 'That event does not repeat.' };
      const series = recurring && (input.applyTo === 'series' || !!input.stopRepeatingAfter);
      const targetId = series ? (cur.recurringEventId ?? cur.id) : cur.id;
      const target = series && cur.recurringEventId ? await googleApi<GEvent>(ctx.c, ctx.owner, 'GET', eventsUrl(input.calendarId, targetId)) : cur;

      const patch: Record<string, unknown> = {};
      if (input.title) patch.summary = input.title;
      if (input.location !== undefined) patch.location = input.location;
      if (input.notes !== undefined) patch.description = input.notes;
      if (input.category) patch.colorId = EVENT_CATEGORIES[input.category as EventCategory].colorId;
      if (input.showAs) patch.transparency = input.showAs === 'free' ? 'transparent' : 'opaque';
      if (input.reminderMinutes) patch.reminders = reminders(input.reminderMinutes);

      // For a whole series, keep the series' own first date and change only the time of day.
      const seriesDate = target.start.dateTime ? toLocalWhen(new Date(target.start.dateTime), ctx.timezone).slice(0, 10) : target.start.date;
      const fix = (w: string) => (series && w.includes('T') && seriesDate ? `${seriesDate}${w.slice(10)}` : w);
      const start = input.start && fix(input.start);
      let end = input.end && fix(input.end);
      if (start) {
        patch.start = toGoogleTime(start, ctx.timezone);
        if (!end) {
          if (target.start.dateTime && target.end.dateTime && start.includes('T')) {
            const dur = Date.parse(target.end.dateTime) - Date.parse(target.start.dateTime);
            end = toLocalWhen(new Date(localToUtc(start, ctx.timezone).getTime() + dur), ctx.timezone);
            patch.end = toGoogleTime(end, ctx.timezone);
          } else patch.end = defaultEnd(start, ctx.timezone);
        }
      }
      if (end) patch.end = toGoogleTime(end.includes('T') ? end : addDays(end, 1), ctx.timezone);
      if (input.stopRepeatingAfter) {
        const rule = target.recurrence?.find((r) => r.startsWith('RRULE:'));
        if (!rule) return { error: 'That event does not repeat.' };
        const kept = rule.slice(6).split(';').filter((p) => !/^(UNTIL|COUNT)=/.test(p));
        patch.recurrence = [
          ...target.recurrence!.filter((r) => !r.startsWith('RRULE:')),
          `RRULE:${[...kept, `UNTIL=${untilValue(input.stopRepeatingAfter, !!target.start.dateTime, ctx.timezone)}`].join(';')}`,
        ];
      }
      const ev = await googleApi<GEvent>(ctx.c, ctx.owner, 'PATCH', `${eventsUrl(input.calendarId, targetId)}?sendUpdates=none`, patch);
      return { updated: describeEvent(ev, ctx), appliedTo: series ? 'series' : 'this', ...(start && !series && (await dayCheck(ctx, ev))) };
    });
  },
});

export const deleteEvent = defineTool({
  name: 'delete_event',
  description:
    'Delete an event. Only after the owner clearly asked for that specific event to be removed (confirm first if there is any doubt which one). For a recurring event, applyTo "series" deletes every occurrence, past and future; to just end it from now on, use update_event stopRepeatingAfter instead.',
  input: z.object({ eventId: z.string().min(1), calendarId: z.string().min(1).max(300).default('primary'), applyTo: z.enum(['this', 'series']).default('this') }),
  async run(ctx, input) {
    return withGoogle(async () => {
      let id = input.eventId;
      if (input.applyTo === 'series') {
        const cur = await googleApi<GEvent>(ctx.c, ctx.owner, 'GET', eventsUrl(input.calendarId, input.eventId));
        id = cur.recurringEventId ?? cur.id;
      }
      await googleApi(ctx.c, ctx.owner, 'DELETE', `${eventsUrl(input.calendarId, id)}?sendUpdates=none`);
      return { deleted: true, appliedTo: input.applyTo };
    });
  },
});

/** Busy intervals across every shown calendar (free/busy respects "show as free" and declined events). */
async function busyBlocks(ctx: ToolContext, from: string, to: string): Promise<Interval[]> {
  const cals = await shownCalendars(ctx);
  const res = await googleApi<{ calendars: Record<string, { busy?: Array<{ start: string; end: string }> }> }>(ctx.c, ctx.owner, 'POST', `${CAL}/freeBusy`, {
    timeMin: localToUtc(from, ctx.timezone).toISOString(),
    timeMax: localToUtc(addDays(to, 1), ctx.timezone).toISOString(),
    timeZone: ctx.timezone,
    items: (cals.length ? cals : [{ id: 'primary' }]).slice(0, 50).map((c) => ({ id: c.id })),
  });
  return Object.values(res.calendars).flatMap((c) => (c.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) })));
}

export const findFreeTime = defineTool({
  name: 'find_free_time',
  description: 'Busy blocks across all the owner\'s shown calendars between two local dates. For ready-made meeting options use suggest_times; for what is scheduled use list_events.',
  input: z.object({ from: LocalDay, to: LocalDay.optional() }),
  async run(ctx, input) {
    return withGoogle(async () => {
      const busy = (await busyBlocks(ctx, input.from, input.to ?? input.from))
        .sort((a, b) => a.start.getTime() - b.start.getTime())
        .map((b) => ({ start: formatLocal(b.start, ctx.timezone), end: formatLocal(b.end, ctx.timezone) }));
      return { busy, ...(busy.length === 0 && { note: 'Free the whole time.' }) };
    });
  },
});

const endTime = (d: Date, tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d);

export const suggestTimes = defineTool({
  name: 'suggest_times',
  description:
    'Good open times for a meeting or study block, checked against all shown calendars with a buffer around existing plans, inside the owner\'s usual day. Returns up to `count` options spread across days, each with a label to paste into a group chat and a start for create_event.',
  input: z.object({
    from: LocalDay.optional().describe('Defaults to today'),
    to: LocalDay.optional().describe('Defaults to 7 days from `from`; at most 14 days'),
    durationMinutes: z.number().int().min(15).max(480).default(60),
    count: z.number().int().min(1).max(6).default(3),
    earliest: HHMM.optional().describe('Overrides the start of their usual day'),
    latest: HHMM.optional().describe('Latest end time'),
    prefer: HHMM.optional().describe('Preferred start time, e.g. "15:00" for afternoons'),
    weekdaysOnly: z.boolean().default(false),
    bufferMinutes: z.number().int().min(0).max(60).default(15),
  }),
  async run(ctx, input) {
    return withGoogle(async () => {
      const profile = await profileOf(ctx);
      const today = localDate(ctx.now, ctx.timezone);
      const from = input.from && input.from > today ? input.from : today;
      let to = input.to ?? addDays(from, 7);
      if (to > addDays(from, 14)) to = addDays(from, 14);
      const dayStart = profile?.prefs?.dayStart ?? DEFAULT_DAY.start;
      const rawEnd = profile?.prefs?.dayEnd ?? DEFAULT_DAY.end;
      const dayEnd = rawEnd <= dayStart ? '23:30' : rawEnd; // a usual day ending after midnight
      const windowStart = input.earliest ?? dayStart;
      const windowEnd = input.latest ?? dayEnd;
      if (windowEnd <= windowStart) return { slots: [], note: 'That time window is empty.' };
      const slots = freeSlots({
        from,
        to,
        zone: ctx.timezone,
        busy: await busyBlocks(ctx, from, to),
        durationMin: input.durationMinutes,
        windowStart,
        windowEnd,
        bufferMin: input.bufferMinutes,
        // At least an hour's notice, on a half-hour boundary.
        notBefore: new Date(Math.ceil((ctx.now.getTime() + 3_600_000) / 1_800_000) * 1_800_000),
        weekdaysOnly: input.weekdaysOnly,
        prefer: input.prefer,
        count: input.count,
      });
      return {
        searched: { from, to, between: `${windowStart}-${windowEnd}` },
        slots: slots.map((s) => ({ label: `${formatLocal(s.start, ctx.timezone)}–${endTime(s.end, ctx.timezone)}`, start: toLocalWhen(s.start, ctx.timezone), end: toLocalWhen(s.end, ctx.timezone) })),
        ...(slots.length === 0 && { note: 'Nothing open in that range; try a wider range, a shorter meeting, or outside their usual hours.' }),
      };
    });
  },
});

export const CALENDAR_TOOLS = [listCalendars, listEvents, createEvent, updateEvent, deleteEvent, findFreeTime, suggestTimes];

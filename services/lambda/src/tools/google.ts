import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { buildMime, formatLocal, localToUtc, toGmailRaw, type Shift } from '@app/core';
import { authUrl, CALENDAR_SCOPE, disconnect, getConnection, googleApi, GoogleNotConnected } from '../google.js';
import { onboardingPacketFile, shiftIcsFile, type Artifact } from '../artifacts.js';
import { defineTool, type ToolContext } from './registry.js';
import { resolveVolunteer } from './volunteers.js';

const CAL = 'https://www.googleapis.com/calendar/v3';
const LocalDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Id = z.string().regex(/^[a-f0-9]{24}$/);

/** Turn "not connected" into guidance the model can relay, instead of a tool error. */
async function withGoogle<T>(fn: () => Promise<T>) {
  try {
    return { ok: true as const, value: await fn() };
  } catch (err) {
    if (err instanceof GoogleNotConnected) return { ok: false as const, content: err.message };
    throw err;
  }
}

export const connectGoogle = defineTool({
  name: 'connect_google',
  description:
    'Give the coordinator a link to connect their Google account, so Tari can keep shifts on a separate "Tari" calendar in their account (it cannot touch their own calendars), check when they are busy (busy/free only), and write emails into their Gmail Drafts (Tari never sends email). The link works for 15 minutes.',
  input: z.object({}),
  async run(ctx) {
    const existing = await getConnection(ctx.c, ctx.coordinator);
    return { ok: true, content: JSON.stringify({ url: await authUrl(ctx.coordinator), alreadyConnectedAs: existing?.email ?? null, note: 'Put the URL on its own line. Mention Google will show an "unverified app" screen during the pilot; tap Continue.' }) };
  },
});

export const googleStatus = defineTool({
  name: 'google_status',
  description: 'Whether Google is connected, and as which account.',
  input: z.object({}),
  async run(ctx) {
    const conn = await getConnection(ctx.c, ctx.coordinator);
    return { ok: true, content: JSON.stringify(conn ? { connected: true, email: conn.email, since: conn.connectedAt } : { connected: false }) };
  },
});

export const disconnectGoogle = defineTool({
  name: 'disconnect_google',
  description: "Disconnect Google: revokes Tari's access at Google and deletes the stored credential.",
  input: z.object({}),
  async run(ctx) {
    return { ok: true, content: (await disconnect(ctx.c, ctx.coordinator)) ? 'Disconnected and access revoked.' : 'Google was not connected.' };
  },
});

export async function busyBlocks(ctx: ToolContext, from: Date, to: Date) {
  const res = await googleApi<{ calendars: Record<string, { busy: Array<{ start: string; end: string }> }> }>(ctx.c, ctx.coordinator, 'POST', `${CAL}/freeBusy`, {
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    timeZone: ctx.timezone,
    items: [{ id: 'primary' }],
  });
  return (res.calendars.primary?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
}

export const checkCalendar = defineTool({
  name: 'check_calendar',
  description: "When the coordinator is busy on their Google Calendar (busy/free blocks only, no event details). Use before proposing shift times.",
  input: z.object({ from: LocalDay, to: LocalDay.optional() }),
  async run(ctx, input) {
    const from = localToUtc(input.from, ctx.timezone);
    const to = new Date(localToUtc(input.to ?? input.from, ctx.timezone).getTime() + 86_400_000);
    const r = await withGoogle(() => busyBlocks(ctx, from, to));
    if (!r.ok) return { ok: false, content: r.content };
    return { ok: true, content: JSON.stringify({ busy: r.value.map((b) => ({ start: formatLocal(b.start, ctx.timezone), end: formatLocal(b.end, ctx.timezone) })), note: r.value.length ? undefined : 'Free the whole time.' }) };
  },
});

function eventBody(s: Shift, timezone: string, shiftId: string) {
  return {
    summary: s.status === 'cancelled' ? `CANCELLED: ${s.title}` : s.title,
    location: s.location,
    description: `${s.description}\n\nVolunteer shift (capacity ${s.capacity}). Managed by Tari.`,
    start: { dateTime: s.start.toISOString(), timeZone: timezone },
    end: { dateTime: s.end.toISOString(), timeZone: timezone },
    extendedProperties: { private: { tariShiftId: shiftId } },
  };
}

/**
 * The dedicated calendar Tari writes shifts to, created on first use. If the coordinator deleted it,
 * a fresh one is made and stale event ids are dropped.
 */
async function tariCalendarId(ctx: ToolContext): Promise<string> {
  const conn = await getConnection(ctx.c, ctx.coordinator);
  if (!conn) throw new GoogleNotConnected();
  if (!conn.scopes.includes(CALENDAR_SCOPE)) throw new GoogleNotConnected('needs_reconnect');
  if (conn.calendarId) {
    try {
      await googleApi(ctx.c, ctx.coordinator, 'GET', `${CAL}/calendars/${encodeURIComponent(conn.calendarId)}`);
      return conn.calendarId;
    } catch (err) {
      if (!/Google API (404|410)/.test(String(err))) throw err;
      await ctx.c.shifts.updateMany({}, { $unset: { [`googleEvents.${ctx.coordinator}`]: '' } });
    }
  }
  const org = (await ctx.c.settings.findOne({ _id: 'org' }))?.orgName ?? 'Volunteer';
  const cal = await googleApi<{ id: string }>(ctx.c, ctx.coordinator, 'POST', `${CAL}/calendars`, {
    summary: `Tari: ${org} shifts`,
    description: 'Volunteer shifts managed by Tari. Edit shifts by texting Tari so everything stays in sync.',
    timeZone: ctx.timezone,
  });
  await ctx.c.googleConnections.updateOne({ _id: ctx.coordinator }, { $set: { calendarId: cal.id } });
  return cal.id;
}

const eventsUrl = (calendarId: string, eventId?: string) => `${CAL}/calendars/${encodeURIComponent(calendarId)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ''}`;

/**
 * Create or update the coordinator's calendar event for a shift. Best-effort: calendar sync never
 * blocks recording the shift itself. Returns a short status the agent can mention.
 */
export async function syncShiftToCalendar(ctx: ToolContext, s: Shift & { _id: ObjectId }): Promise<string | null> {
  if (!(await getConnection(ctx.c, ctx.coordinator))) return null;
  const shiftId = String(s._id);
  try {
    const calendarId = await tariCalendarId(ctx);
    // Re-read: tariCalendarId may have cleared stale ids if the calendar was recreated.
    const existing = (await ctx.c.shifts.findOne({ _id: s._id }))?.googleEvents?.[ctx.coordinator];
    if (s.status === 'cancelled') {
      if (existing) await googleApi(ctx.c, ctx.coordinator, 'DELETE', eventsUrl(calendarId, existing)).catch(() => {});
      await ctx.c.shifts.updateOne({ _id: s._id }, { $unset: { [`googleEvents.${ctx.coordinator}`]: '' } });
      return existing ? 'removed from the Tari calendar' : null;
    }
    if (existing) {
      try {
        await googleApi(ctx.c, ctx.coordinator, 'PATCH', eventsUrl(calendarId, existing), eventBody(s, ctx.timezone, shiftId));
        return 'updated on the Tari calendar';
      } catch (err) {
        if (!/Google API (404|410)/.test(String(err))) throw err; // event deleted by hand: recreate below
      }
    }
    const ev = await googleApi<{ id: string }>(ctx.c, ctx.coordinator, 'POST', eventsUrl(calendarId), eventBody(s, ctx.timezone, shiftId));
    await ctx.c.shifts.updateOne({ _id: s._id }, { $set: { [`googleEvents.${ctx.coordinator}`]: ev.id } });
    return 'added to the Tari calendar';
  } catch (err) {
    ctx.log.warn('calendar sync failed', { err: (err as Error).message });
    return err instanceof GoogleNotConnected ? 'not synced: Google needs reconnecting (connect_google)' : 'not synced to Google Calendar (will retry next change)';
  }
}

export const syncShiftsToCalendar = defineTool({
  name: 'sync_shifts_to_calendar',
  description: "Put upcoming shifts (default: next 30 days) on the dedicated Tari calendar in the coordinator's Google account (never their main calendar). Safe to repeat: events are updated, not duplicated, and events for deleted shifts are removed.",
  input: z.object({ days: z.number().int().min(1).max(90).default(30) }),
  async run(ctx, input) {
    if (!(await getConnection(ctx.c, ctx.coordinator))) return { ok: false, content: 'Google is not connected; use connect_google.' };
    const shifts = (await ctx.c.shifts.find({ start: { $gte: ctx.now, $lt: new Date(ctx.now.getTime() + input.days * 86_400_000) } }).sort({ start: 1 }).toArray()) as Array<Shift & { _id: ObjectId }>;
    const results = [];
    for (const s of shifts) results.push({ shift: `${s.title}, ${formatLocal(s.start, ctx.timezone)}`, result: await syncShiftToCalendar(ctx, s) });
    const removed = await removeOrphanedEvents(ctx).catch(() => 0);
    return { ok: true, content: JSON.stringify({ synced: results, ...(removed && { removedStaleEvents: removed }) }) };
  },
});

/** Events on the Tari calendar whose shift no longer exists or was cancelled (only Tari's own calendar is touched). */
async function removeOrphanedEvents(ctx: ToolContext): Promise<number> {
  const calendarId = await tariCalendarId(ctx);
  const res = await googleApi<{ items?: Array<{ id: string; extendedProperties?: { private?: { tariShiftId?: string } } }> }>(
    ctx.c, ctx.coordinator, 'GET', `${eventsUrl(calendarId)}?maxResults=250&timeMin=${encodeURIComponent(new Date(ctx.now.getTime() - 86_400_000).toISOString())}`,
  );
  let removed = 0;
  for (const ev of res.items ?? []) {
    const shiftId = ev.extendedProperties?.private?.tariShiftId;
    const live = shiftId && /^[a-f0-9]{24}$/.test(shiftId) && (await ctx.c.shifts.findOne({ _id: new ObjectId(shiftId), status: 'scheduled' }));
    if (!live) {
      await googleApi(ctx.c, ctx.coordinator, 'DELETE', eventsUrl(calendarId, ev.id)).catch(() => {});
      removed++;
    }
  }
  return removed;
}

export const draftEmail = defineTool({
  name: 'draft_email',
  description:
    "Write an email into the coordinator's Gmail Drafts for them to review and send (Tari never sends). Address it to volunteers by name (their email comes from the roster) and/or explicit addresses. Can attach an onboarding packet or a shift calendar invite. Same privacy rules as text drafts.",
  input: z.object({
    toVolunteers: z.array(z.string()).max(50).default([]),
    toEmails: z.array(z.string().email()).max(20).default([]),
    subject: z.string().min(1).max(150),
    body: z.string().min(1).max(5000),
    attach: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('onboarding_packet'), volunteerName: z.string() }),
        z.object({ kind: z.literal('shift_calendar_invite'), shiftId: Id }),
      ])
      .optional(),
  }),
  async run(ctx, input) {
    const to = [...input.toEmails];
    const problems: string[] = [];
    for (const name of input.toVolunteers) {
      const found = await resolveVolunteer(ctx, name);
      if ('error' in found) problems.push(found.error);
      else if (!found.volunteer.email) problems.push(`${found.volunteer.name} has no email on file.`);
      else to.push(found.volunteer.email);
    }
    let attachment: Artifact | undefined;
    if (input.attach?.kind === 'onboarding_packet') {
      const found = await resolveVolunteer(ctx, input.attach.volunteerName);
      if ('error' in found) return { ok: false, content: found.error };
      attachment = await onboardingPacketFile(ctx, found.volunteer);
    } else if (input.attach?.kind === 'shift_calendar_invite') {
      const s = (await ctx.c.shifts.findOne({ _id: new ObjectId(input.attach.shiftId) })) as (Shift & { _id: ObjectId }) | null;
      if (!s) return { ok: false, content: 'No shift with that id.' };
      attachment = await shiftIcsFile(ctx, s);
    }
    const raw = toGmailRaw(buildMime({ to, subject: input.subject, text: input.body, attachments: attachment ? [attachment] : [] }));
    const r = await withGoogle(() => googleApi<{ id: string }>(ctx.c, ctx.coordinator, 'POST', 'https://gmail.googleapis.com/gmail/v1/users/me/drafts', { message: { raw } }));
    if (!r.ok) return { ok: false, content: r.content };
    return {
      ok: true,
      content: JSON.stringify({ draftSaved: true, recipients: to.length, attachment: attachment?.filename ?? null, problems, openDrafts: 'https://mail.google.com/mail/#drafts', note: 'Remind them it is a draft: nothing was sent.' }),
    };
  },
});


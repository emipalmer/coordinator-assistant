import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { formatLocal, pickLapsed, upcomingBirthdays, type Availability, type Shift, type Volunteer } from '@app/core';
import { defineTool, type ToolContext } from './registry.js';
import { resolveVolunteer, searchVolunteers } from './volunteers.js';

export const dailyCheck = defineTool({
  name: 'daily_check',
  description:
    'Morning check-in data: birthdays today and this week, and volunteers who have not come in for a while. Write a [[draft]] for each birthday today and each check-in.',
  input: z.object({}),
  async run(ctx) {
    const vols = await ctx.c.volunteers.find({ status: { $ne: 'inactive' } }, { projection: { notesEmbedding: 0 } }).toArray();
    const birthdays = upcomingBirthdays(vols, ctx.now, ctx.timezone, 7).map((b) => ({
      name: b.person.name, date: b.date, inDays: b.inDays, interests: b.person.interests, notes: b.person.notes,
    }));
    const lapsed = pickLapsed(await ctx.c.volunteers.find({}, { projection: { notesEmbedding: 0 } }).toArray(), ctx.now).slice(0, 3);
    // Mark now so tomorrow's check doesn't repeat the same people.
    if (lapsed.length) {
      await ctx.c.volunteers.updateMany({ _id: { $in: lapsed.map((l) => l.person._id) } }, { $set: { lastCheckInDraftAt: ctx.now } });
    }
    return {
      ok: true,
      content: JSON.stringify({
        birthdaysToday: birthdays.filter((b) => b.inDays === 0),
        birthdaysThisWeek: birthdays.filter((b) => b.inDays > 0),
        checkIns: lapsed.map((l) => ({ name: l.person.name, daysSinceLastShift: l.daysAway, interests: l.person.interests, notes: l.person.notes })),
      }),
    };
  },
});

const DAYS: Availability['day'][] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as never;

/** Day and part of day a shift falls in, in the org's timezone, to match against availability. */
export function shiftSlot(start: Date, timezone: string): Availability {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(start).map((p) => [p.type, p.value]),
  );
  const day = parts.weekday!.slice(0, 3).toLowerCase() as Availability['day'];
  const hour = Number(parts.hour);
  return { day: DAYS.includes(day) ? day : 'sat', part: hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening' };
}

export async function backfillCandidates(ctx: ToolContext, shift: Shift & { _id: ObjectId }, excludeIds: ObjectId[]) {
  const slot = shiftSlot(shift.start, ctx.timezone);
  // Semantic match on what the shift needs; availability narrows it to people who can actually come.
  const query = [shift.title, shift.description, shift.requiredSkills.length ? `Skills: ${shift.requiredSkills.join(', ')}` : ''].filter(Boolean).join('. ');
  let candidates = await searchVolunteers(ctx, { query, day: slot.day, part: slot.part, status: 'active', limit: 3, excludeIds });
  let relaxed = false;
  if (candidates.length < 2) {
    candidates = await searchVolunteers(ctx, { query, day: slot.day, status: 'active', limit: 3, excludeIds });
    relaxed = true;
  }
  return { slot, relaxedAvailability: relaxed, candidates };
}

export const suggestBackfill = defineTool({
  name: 'suggest_backfill',
  description: 'Suggest replacement volunteers for a shift (vector search on the shift needs, filtered by availability). Excludes people already signed up.',
  input: z.object({ shiftId: z.string().regex(/^[a-f0-9]{24}$/), excludeName: z.string().optional() }),
  async run(ctx, input) {
    const shift = (await ctx.c.shifts.findOne({ _id: new ObjectId(input.shiftId) })) as (Shift & { _id: ObjectId }) | null;
    if (!shift) return { ok: false, content: 'No shift with that id.' };
    const assigned = await ctx.c.assignments.find({ shiftId: shift._id }).toArray();
    const exclude = assigned.map((a) => a.volunteerId as ObjectId);
    if (input.excludeName) {
      const found = await resolveVolunteer(ctx, input.excludeName);
      if ('volunteer' in found) exclude.push(found.volunteer._id);
    }
    const result = await backfillCandidates(ctx, shift, exclude);
    return { ok: true, content: JSON.stringify({ shift: { id: input.shiftId, title: shift.title, when: formatLocal(shift.start, ctx.timezone) }, ...result }) };
  },
});

/** Facts the agent needs to announce a cancellation, gathered without an LLM round trip. */
export async function describeCancellation(ctx: ToolContext, assignmentId: string) {
  const a = await ctx.c.assignments.findOne({ _id: new ObjectId(assignmentId) });
  if (!a || a.status !== 'cancelled') return null;
  const [shift, vol] = await Promise.all([
    ctx.c.shifts.findOne({ _id: a.shiftId as ObjectId }),
    ctx.c.volunteers.findOne({ _id: a.volunteerId as ObjectId }, { projection: { name: 1 } }) as Promise<Pick<Volunteer, 'name'> | null>,
  ]);
  if (!shift || shift.start < ctx.now) return null; // past shifts don't need a backfill
  const confirmed = await ctx.c.assignments.countDocuments({ shiftId: a.shiftId, status: 'confirmed' });
  return { shiftId: String(a.shiftId), shiftTitle: shift.title, when: formatLocal(shift.start, ctx.timezone), volunteer: vol?.name ?? 'A volunteer', openSpots: shift.capacity - confirmed };
}

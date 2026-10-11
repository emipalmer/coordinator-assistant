import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { formatLocal, localDate, localToUtc, type Shift } from '@app/core';
import { defineTool, type ToolContext } from './registry.js';
import { resolveVolunteer } from './volunteers.js';

const LocalDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'YYYY-MM-DDTHH:mm in local time');
const LocalDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const Id = z.string().regex(/^[a-f0-9]{24}$/, 'id from list_shifts');

async function shiftView(ctx: ToolContext, s: Shift & { _id: ObjectId }) {
  const assigned = await ctx.c.assignments.find({ shiftId: s._id, status: 'confirmed' }).toArray();
  const names = assigned.length
    ? await ctx.c.volunteers.find({ _id: { $in: assigned.map((a) => a.volunteerId as ObjectId) } }, { projection: { name: 1 } }).toArray()
    : [];
  return {
    id: String(s._id),
    title: s.title,
    when: `${formatLocal(s.start, ctx.timezone)} - ${formatLocal(s.end, ctx.timezone).split(', ').pop()}`,
    location: s.location,
    status: s.status,
    capacity: s.capacity,
    openSpots: Math.max(0, s.capacity - assigned.length),
    requiredSkills: s.requiredSkills,
    volunteers: names.map((n) => n.name),
  };
}

export const createShift = defineTool({
  name: 'create_shift',
  description: 'Create a volunteer shift. Times are local wall-clock times.',
  input: z.object({
    title: z.string().min(1),
    start: LocalDateTime,
    end: LocalDateTime,
    location: z.string().optional(),
    capacity: z.number().int().min(1).max(200).default(5),
    requiredSkills: z.array(z.string()).default([]),
    description: z.string().default(''),
  }),
  async run(ctx, input) {
    const start = localToUtc(input.start, ctx.timezone);
    const end = localToUtc(input.end, ctx.timezone);
    if (end <= start) return { ok: false, content: 'Shift end must be after start.' };
    const doc: Shift = { ...input, start, end, status: 'scheduled', createdAt: new Date() };
    const res = await ctx.c.shifts.insertOne(doc);
    return { ok: true, content: JSON.stringify({ created: await shiftView(ctx, { ...doc, _id: res.insertedId }) }) };
  },
});

export const listShifts = defineTool({
  name: 'list_shifts',
  description: 'List shifts between two local dates (defaults: today through the next 14 days), with who is signed up and open spots.',
  input: z.object({ from: LocalDay.optional(), to: LocalDay.optional(), includeCancelled: z.boolean().default(false) }),
  async run(ctx, input) {
    const from = localToUtc(input.from ?? localDate(ctx.now, ctx.timezone), ctx.timezone);
    const to = input.to ? new Date(localToUtc(input.to, ctx.timezone).getTime() + 86_400_000) : new Date(from.getTime() + 15 * 86_400_000);
    const shifts = (await ctx.c.shifts
      .find({ start: { $gte: from, $lt: to }, ...(input.includeCancelled ? {} : { status: 'scheduled' }) })
      .sort({ start: 1 })
      .limit(30)
      .toArray()) as Array<Shift & { _id: ObjectId }>;
    return { ok: true, content: JSON.stringify({ shifts: await Promise.all(shifts.map((s) => shiftView(ctx, s))) }) };
  },
});

export const assignVolunteers = defineTool({
  name: 'assign_volunteers',
  description: 'Sign volunteers up for a shift (get the shift id from list_shifts).',
  input: z.object({ shiftId: Id, names: z.array(z.string()).min(1) }),
  async run(ctx, input) {
    const shift = await ctx.c.shifts.findOne({ _id: new ObjectId(input.shiftId) });
    if (!shift) return { ok: false, content: 'No shift with that id.' };
    const added: string[] = [];
    const problems: string[] = [];
    for (const name of input.names) {
      const found = await resolveVolunteer(ctx, name);
      if ('error' in found) {
        problems.push(found.error);
        continue;
      }
      const v = found.volunteer;
      // Upsert so re-assigning someone who previously cancelled just flips them back.
      await ctx.c.assignments.updateOne(
        { shiftId: shift._id, volunteerId: v._id },
        { $set: { status: 'confirmed' }, $unset: { cancelledAt: '' }, $setOnInsert: { createdAt: new Date() } },
        { upsert: true },
      );
      added.push(v.name);
    }
    return { ok: problems.length === 0, content: JSON.stringify({ assigned: added, problems, shift: await shiftView(ctx, shift as Shift & { _id: ObjectId }) }) };
  },
});

export const cancelAssignment = defineTool({
  name: 'cancel_assignment',
  description: 'Record that a volunteer can no longer make a shift. Triggers a backfill suggestion automatically.',
  input: z.object({ shiftId: Id, name: z.string() }),
  async run(ctx, input) {
    const found = await resolveVolunteer(ctx, input.name);
    if ('error' in found) return { ok: false, content: found.error };
    const res = await ctx.c.assignments.updateOne(
      { shiftId: new ObjectId(input.shiftId), volunteerId: found.volunteer._id, status: 'confirmed' },
      { $set: { status: 'cancelled', cancelledAt: new Date() } },
    );
    if (res.matchedCount === 0) return { ok: false, content: `${found.volunteer.name} isn't signed up for that shift.` };
    return { ok: true, content: JSON.stringify({ cancelled: found.volunteer.name, note: 'Backfill suggestions will follow in a separate message.' }) };
  },
});

export const logAttendance = defineTool({
  name: 'log_attendance',
  description:
    'Log hours volunteers worked, e.g. "Saturday pantry: Sam 4h, Maria 3h". Logs every name it can resolve and reports any it could not.',
  input: z.object({
    date: LocalDay.describe('Local date worked'),
    entries: z.array(z.object({ name: z.string(), hours: z.number().positive().max(24) })).min(1),
    shiftId: Id.optional(),
    activity: z.string().optional().describe('e.g. "pantry"'),
  }),
  async run(ctx, input) {
    const date = localToUtc(input.date, ctx.timezone);
    const logged: Array<{ name: string; hours: number }> = [];
    const problems: string[] = [];
    for (const e of input.entries) {
      const found = await resolveVolunteer(ctx, e.name);
      if ('error' in found) {
        problems.push(found.error);
        continue;
      }
      const v = found.volunteer;
      // One record per volunteer per day+activity: re-texting the same hours corrects instead of double counting.
      await ctx.c.attendance.updateOne(
        { volunteerId: v._id, date, activity: input.activity ?? null },
        {
          $set: { hours: e.hours, ...(input.shiftId && { shiftId: new ObjectId(input.shiftId) }) },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true },
      );
      if (!v.lastActiveAt || v.lastActiveAt < date) {
        await ctx.c.volunteers.updateOne({ _id: v._id }, { $set: { lastActiveAt: date, ...(v.status === 'inactive' && { status: 'active' }) } });
      }
      logged.push({ name: v.name, hours: e.hours });
    }
    const total = logged.reduce((s, l) => s + l.hours, 0);
    return { ok: problems.length === 0, content: JSON.stringify({ logged, totalHours: total, problems }) };
  },
});

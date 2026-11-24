import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { formatLocal, localToUtc } from '@app/core';
import { defineTool } from './registry.js';

const LocalDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
const MAX_PENDING = 100;

export const setReminder = defineTool({
  name: 'set_reminder',
  description:
    'Have Star text the owner at a specific local time ("remind me at 9 to submit the lab"). Optionally repeating daily, on weekdays, or weekly. For a to-do without a set time, use add_task instead. Reminders the owner sets always go out, even late at night.',
  input: z.object({
    when: LocalDateTime.describe('Local "YYYY-MM-DDTHH:mm"; resolve "in 20 min" or "tmrw at 9" from the context time'),
    text: z.string().min(1).max(300).describe('What to remind them about, in their words'),
    repeat: z.enum(['daily', 'weekdays', 'weekly']).optional(),
  }),
  async run(ctx, input) {
    const dueAt = localToUtc(input.when, ctx.timezone);
    if (dueAt.getTime() < ctx.now.getTime() - 60_000) return { ok: false, content: 'That time has already passed; pick a future time.' };
    if (dueAt.getTime() > ctx.now.getTime() + 366 * 86_400_000) return { ok: false, content: 'Reminders can be set up to a year ahead.' };
    const pending = await ctx.c.reminders.countDocuments({ owner: ctx.owner, status: 'pending' });
    if (pending >= MAX_PENDING) return { ok: false, content: `There are already ${MAX_PENDING} pending reminders; cancel some first.` };
    const id = randomBytes(3).toString('hex');
    await ctx.c.reminders.insertOne({ _id: id, owner: ctx.owner, text: input.text, dueAt, ...(input.repeat && { repeat: input.repeat }), status: 'pending', createdAt: ctx.now });
    return { ok: true, content: JSON.stringify({ id, at: formatLocal(dueAt, ctx.timezone), repeat: input.repeat }) };
  },
});

export const listReminders = defineTool({
  name: 'list_reminders',
  description: 'Upcoming reminders (soonest first), with ids for cancel_reminder.',
  input: z.object({}),
  async run(ctx) {
    const list = await ctx.c.reminders.find({ owner: ctx.owner, status: 'pending' }).sort({ dueAt: 1 }).limit(50).toArray();
    return { ok: true, content: JSON.stringify(list.map((r) => ({ id: r._id, text: r.text, at: formatLocal(r.dueAt, ctx.timezone), repeat: r.repeat }))) };
  },
});

export const cancelReminder = defineTool({
  name: 'cancel_reminder',
  description: 'Cancel a pending reminder by id (stops a repeating one for good).',
  input: z.object({ id: z.string().regex(/^[a-f0-9]{6}$/) }),
  async run(ctx, input) {
    const r = await ctx.c.reminders.updateOne({ _id: input.id, owner: ctx.owner, status: 'pending' }, { $set: { status: 'cancelled' } });
    return { ok: true, content: r.modifiedCount ? 'Cancelled.' : 'No pending reminder with that id.' };
  },
});

export const REMINDER_TOOLS = [setReminder, listReminders, cancelReminder];

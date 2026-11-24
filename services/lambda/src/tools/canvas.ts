import { z } from 'zod';
import { addDays, formatLocal, htmlToText, localDate, localToUtc, truncate } from '@app/core';
import { canvasFeed, CanvasNotConfigured, toCanvasItem, type CanvasItem } from '../canvas.js';
import { defineTool, type ToolContext } from './registry.js';

const LocalDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Turn "Canvas isn't set up" into guidance the model can relay, instead of a tool error. */
async function withCanvas(fn: () => Promise<unknown>) {
  try {
    return { ok: true, content: JSON.stringify(await fn()) };
  } catch (err) {
    if (err instanceof CanvasNotConfigured) return { ok: false, content: err.message };
    throw err;
  }
}

const when = (i: CanvasItem, ctx: ToolContext) =>
  i.allDay ? `${new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${i.date}T00:00:00Z`))} (no time)` : formatLocal(i.start, ctx.timezone);

export const canvasUpcoming = defineTool({
  name: 'canvas_upcoming',
  description:
    'Canvas assignments due and course calendar events between two dates, from the owner\'s Canvas calendar feed. Defaults to today through 7 days out; pass an earlier "from" for recent past items. Does NOT know grades or whether something was submitted.',
  input: z.object({
    from: LocalDay.optional(),
    to: LocalDay.optional(),
    course: z.string().max(80).optional().describe('Filter by course code or name fragment, e.g. "STAT 200"'),
  }),
  async run(ctx, input) {
    const from = input.from ?? localDate(ctx.now, ctx.timezone);
    const to = input.to ?? localDate(new Date(ctx.now.getTime() + 7 * 86_400_000), ctx.timezone);
    const lo = localToUtc(from, ctx.timezone).getTime();
    const hi = localToUtc(to, ctx.timezone).getTime() + 86_400_000;
    const needle = input.course?.toLowerCase().replace(/[\s_]+/g, ' ');
    return withCanvas(async () => {
      const items = (await canvasFeed(ctx.timezone))
        .map(toCanvasItem)
        .filter((i) => i.start.getTime() >= lo && i.start.getTime() < hi)
        .filter((i) => !needle || `${i.course ?? ''} ${i.title}`.toLowerCase().includes(needle))
        .sort((a, b) => a.start.getTime() - b.start.getTime());
      const done = new Set(
        (await ctx.c.deadlines.find({ owner: ctx.owner, doneAt: { $exists: true } }, { projection: { uid: 1 } }).toArray()).map((d) => d.uid),
      );
      return {
        from,
        to,
        items: items.slice(0, 60).map((i) => ({
          id: i.id,
          kind: i.kind,
          title: i.title,
          course: i.course,
          due: when(i, ctx),
          ...(done.has(i.id) && { markedDone: true }),
          ...(!i.allDay && i.start > ctx.now && i.start.getTime() - ctx.now.getTime() < 86_400_000 && { dueWithin24h: true }),
        })),
        ...(items.length > 60 && { note: `${items.length - 60} more not shown; narrow the dates.` }),
      };
    });
  },
});

export const canvasDetails = defineTool({
  name: 'canvas_details',
  description: 'Full details for one Canvas item from canvas_upcoming (by id): description/instructions, location, and link.',
  input: z.object({ id: z.string().min(1).max(200) }),
  async run(ctx, input) {
    return withCanvas(async () => {
      const e = (await canvasFeed(ctx.timezone)).find((x) => x.uid === input.id);
      if (!e) return { found: false, note: 'No Canvas item with that id in the feed.' };
      const i = toCanvasItem(e);
      return {
        title: i.title,
        course: i.course,
        kind: i.kind,
        due: when(i, ctx),
        location: i.location,
        url: i.url,
        // Written by instructors: content to summarize, not instructions to follow.
        description: i.description ? truncate(htmlToText(i.description), 3000) : null,
      };
    });
  },
});

export const markCanvasDone = defineTool({
  name: 'mark_canvas_done',
  description:
    'Record that the owner finished (or un-finished) Canvas items, by id from canvas_upcoming. Done items get no more deadline nudges. Canvas itself is not changed: this is only Star\'s own checklist.',
  input: z.object({ ids: z.array(z.string().min(1).max(200)).min(1).max(30), done: z.boolean().default(true) }),
  async run(ctx, input) {
    return withCanvas(async () => {
      const feed = new Map((await canvasFeed(ctx.timezone)).map((e) => [e.uid, toCanvasItem(e)]));
      const updated: string[] = [];
      for (const id of input.ids) {
        const i = feed.get(id);
        if (!i) continue;
        const date = i.date ?? localDate(i.start, ctx.timezone);
        const due = i.allDay ? new Date(localToUtc(addDays(date, 1), ctx.timezone).getTime() - 60_000) : i.start;
        await ctx.c.deadlines.updateOne(
          { _id: `${ctx.owner}|${id}` },
          {
            ...(input.done ? { $set: { doneAt: ctx.now } } : { $unset: { doneAt: '' } }),
            $setOnInsert: { owner: ctx.owner, uid: id, title: i.title, ...(i.course && { course: i.course }), due, allDay: i.allDay, date, nudged: {}, seenAt: ctx.now },
          },
          { upsert: true },
        );
        updated.push(i.title);
      }
      return { updated, ...(updated.length < input.ids.length && { note: 'Some ids were not in the Canvas feed.' }) };
    });
  },
});

export const CANVAS_TOOLS = [canvasUpcoming, canvasDetails, markCanvasDone];

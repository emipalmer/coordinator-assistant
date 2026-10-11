import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { localDate, localToUtc, MAX_POINTS, MAX_SERIES, renderChartSvg, validateSpec } from '@app/core';
import { storeFile } from '../files.js';
import { svgToPng } from '../png.js';
import { defineTool, type ToolContext } from './registry.js';

const LocalDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Period keys (YYYY-MM-DD of each period start) between two local dates, so empty periods show as 0. */
export function periodKeys(from: string, to: string, unit: 'month' | 'week'): string[] {
  const keys: string[] = [];
  let d = new Date(`${from}T12:00:00Z`);
  if (unit === 'month') d.setUTCDate(1);
  else d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // weeks start Sunday
  const end = new Date(`${to}T12:00:00Z`);
  while (d <= end && keys.length < 60) {
    keys.push(d.toISOString().slice(0, 10));
    d = unit === 'month' ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 12)) : new Date(d.getTime() + 7 * 86_400_000);
  }
  return keys;
}

function periodLabel(key: string, unit: 'month' | 'week', multiYear: boolean) {
  const d = new Date(`${key}T12:00:00Z`);
  return unit === 'month'
    ? d.toLocaleDateString('en-US', { month: 'short', ...(multiYear && { year: '2-digit' }), timeZone: 'UTC' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export const hoursStats = defineTool({
  name: 'hours_stats',
  description:
    'Aggregate logged volunteer hours for charts and questions like "hours by month", "who volunteered most", "hours by activity". Returns rows of {label, hours, volunteers}. Defaults to the last 6 months.',
  input: z.object({
    groupBy: z.enum(['month', 'week', 'volunteer', 'activity']),
    from: LocalDay.optional(),
    to: LocalDay.optional(),
    top: z.number().int().min(1).max(20).default(10).describe('For volunteer/activity: how many rows'),
  }),
  async run(ctx, input) {
    const to = input.to ?? localDate(ctx.now, ctx.timezone);
    const from = input.from ?? localDate(new Date(ctx.now.getTime() - 182 * 86_400_000), ctx.timezone);
    const match = { date: { $gte: localToUtc(from, ctx.timezone), $lt: new Date(localToUtc(to, ctx.timezone).getTime() + 86_400_000) } };

    if (input.groupBy === 'month' || input.groupBy === 'week') {
      const unit = input.groupBy;
      const rows = await ctx.c.attendance
        .aggregate<{ _id: Date; hours: number; volunteers: unknown[] }>([
          { $match: match },
          {
            $group: {
              _id: { $dateTrunc: { date: '$date', unit, timezone: ctx.timezone, ...(unit === 'week' && { startOfWeek: 'sun' }) } },
              hours: { $sum: '$hours' },
              volunteers: { $addToSet: '$volunteerId' },
            },
          },
        ])
        .toArray();
      const byKey = new Map(rows.map((r) => [localDate(r._id, ctx.timezone), r]));
      const keys = periodKeys(from, to, unit);
      const multiYear = keys[0]?.slice(0, 4) !== keys.at(-1)?.slice(0, 4);
      const out = keys.map((k) => ({ label: periodLabel(k, unit, multiYear), hours: round1(byKey.get(k)?.hours ?? 0), volunteers: byKey.get(k)?.volunteers.length ?? 0 }));
      return { ok: true, content: JSON.stringify({ from, to, groupBy: unit, rows: out }) };
    }

    const field = input.groupBy === 'volunteer' ? '$volunteerId' : { $ifNull: ['$activity', 'general'] };
    const rows = await ctx.c.attendance
      .aggregate<{ _id: unknown; hours: number; volunteers: unknown[] }>([
        { $match: match },
        { $group: { _id: field, hours: { $sum: '$hours' }, volunteers: { $addToSet: '$volunteerId' } } },
        { $sort: { hours: -1 } },
        { $limit: input.top },
      ])
      .toArray();
    let names = new Map<string, string>();
    if (input.groupBy === 'volunteer') {
      const vols = await ctx.c.volunteers.find({ _id: { $in: rows.map((r) => r._id as ObjectId) } }, { projection: { name: 1 } }).toArray();
      names = new Map(vols.map((v) => [String(v._id), v.name]));
    }
    const out = rows.map((r) => ({ label: names.get(String(r._id)) ?? String(r._id), hours: round1(r.hours), volunteers: r.volunteers.length }));
    return { ok: true, content: JSON.stringify({ from, to, groupBy: input.groupBy, rows: out }) };
  },
});

export const makeChart = defineTool({
  name: 'make_chart',
  description: `Render a chart image and send it to the coordinator. Only plot numbers you got from a tool (e.g. hours_stats). Use "column" for values over time (months/weeks), "line" for a trend with up to ${MAX_SERIES} series, "bar" (horizontal) for ranking people or categories. Max ${MAX_POINTS} points. The title says what is plotted; subtitle gives the period.`,
  input: z.object({
    kind: z.enum(['column', 'bar', 'line']),
    title: z.string().min(1).max(60),
    subtitle: z.string().max(80).optional(),
    labels: z.array(z.string().max(24)).min(1).max(MAX_POINTS),
    series: z.array(z.object({ name: z.string().max(24), values: z.array(z.number()) })).min(1).max(MAX_SERIES),
    unit: z.enum(['h', '$', 'people', 'shifts']).optional(),
  }),
  async run(ctx: ToolContext, input) {
    const problem = validateSpec(input);
    if (problem) return { ok: false, content: `Can't draw that: ${problem}` };
    const png = await svgToPng(renderChartSvg(input));
    const slug = input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    ctx.attachments.push(await storeFile('charts', `${slug || 'chart'}.png`, png, 'image/png'));
    return { ok: true, content: 'Chart image will be sent after your reply. Add one sentence on what stands out.' };
  },
});

const round1 = (n: number) => Math.round(n * 10) / 10;

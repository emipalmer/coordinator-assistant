import { z } from 'zod';
import { MAX_POINTS, MAX_SERIES, renderChartSvg, validateSpec } from '@app/core';
import { storeFile } from '../files.js';
import { svgToPng } from '../png.js';
import { defineTool, type ToolContext } from './registry.js';

export const makeChart = defineTool({
  name: 'make_chart',
  description: `Render a chart image and send it to the owner. Only plot numbers you got from a tool or the owner (e.g. Canvas scores, hours of events per week). Use "column" for values over time (months/weeks), "line" for a trend with up to ${MAX_SERIES} series, "bar" (horizontal) for ranking people or categories. Max ${MAX_POINTS} points. The title says what is plotted; subtitle gives the period.`,
  input: z.object({
    kind: z.enum(['column', 'bar', 'line']),
    title: z.string().min(1).max(60),
    subtitle: z.string().max(80).optional(),
    labels: z.array(z.string().max(24)).min(1).max(MAX_POINTS),
    series: z.array(z.object({ name: z.string().max(24), values: z.array(z.number()) })).min(1).max(MAX_SERIES),
    unit: z.string().max(12).optional().describe('e.g. "h", "$", "%", "pts"'),
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

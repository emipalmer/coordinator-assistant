import type { ObjectId } from 'mongodb';
import { buildIcs, FORM_TEMPLATES, localDate, prefill, renderFormPdf, type Shift, type Volunteer } from '@app/core';
import type { ToolContext } from './tools/registry.js';

/** Files Tari can both text (via S3) and attach to Gmail drafts. */
export interface Artifact {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

async function orgName(ctx: ToolContext) {
  return (await ctx.c.settings.findOne({ _id: 'org' }))?.orgName ?? 'Our organization';
}

export async function onboardingPacketFile(ctx: ToolContext, v: Volunteer): Promise<Artifact> {
  const t = FORM_TEMPLATES.onboarding_packet!;
  const org = await orgName(ctx);
  const values = { ...prefill(t, { volunteer: v, orgName: org, today: localDate(ctx.now, ctx.timezone) }), interests: v.interests.join(', ') };
  const bytes = await renderFormPdf(t, values, { orgName: org, generatedLabel: `Prepared ${localDate(ctx.now, ctx.timezone)}`, isMinor: v.isMinor });
  return { filename: `onboarding-${v.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`, contentType: 'application/pdf', bytes };
}

export async function shiftIcsFile(ctx: ToolContext, s: Shift & { _id: ObjectId }): Promise<Artifact> {
  const org = await orgName(ctx);
  const ics = buildIcs({ uid: `shift-${String(s._id)}@coordinator-assistant`, start: s.start, end: s.end, title: `${s.title} - ${org}`, location: s.location, description: s.description, stamp: ctx.now });
  const slug = `${s.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${localDate(s.start, ctx.timezone)}`;
  return { filename: `${slug}.ics`, contentType: 'text/calendar', bytes: new TextEncoder().encode(ics) };
}

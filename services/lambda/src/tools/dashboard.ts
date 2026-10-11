import { z } from 'zod';
import { createHash } from 'node:crypto';
import { signLink } from '@app/core';
import { getSecret } from '../secrets.js';
import { requireEnv } from '../env.js';
import { defineTool } from './registry.js';

const VALID_DAYS = 7;

/**
 * Opaque link subject: an unreadable coordinator id plus the current link version, so the URL
 * never exposes a phone number and "revoke dashboard links" invalidates every link sent so far.
 */
export function linkSubject(coordinator: string, version: number) {
  return `${createHash('sha256').update(coordinator).digest('base64url').slice(0, 12)}:${version}`;
}

export const dashboardLink = defineTool({
  name: 'dashboard_link',
  description: `Send the coordinator a private link to the live dashboard (hours, value, upcoming shifts, paperwork, birthdays). The link works for ${VALID_DAYS} days; tell them not to forward it, since it shows volunteer details.`,
  input: z.object({}),
  async run(ctx) {
    const version = (await ctx.c.settings.findOne({ _id: 'org' }))?.dashboardLinkVersion ?? 1;
    const token = signLink(await getSecret(requireEnv('DASHBOARD_SECRET_PARAM')), linkSubject(ctx.coordinator, version), new Date(ctx.now.getTime() + VALID_DAYS * 86_400_000));
    return { ok: true, content: JSON.stringify({ url: `${requireEnv('DASHBOARD_URL')}?t=${token}`, validDays: VALID_DAYS, note: 'Put the URL on its own line so it is tappable.' }) };
  },
});

export const revokeDashboardLinks = defineTool({
  name: 'revoke_dashboard_links',
  description: 'Immediately invalidate every dashboard link sent so far (e.g. if one was forwarded by mistake). A new link can be requested afterwards.',
  input: z.object({}),
  async run(ctx) {
    await ctx.c.settings.updateOne({ _id: 'org' }, { $inc: { dashboardLinkVersion: 1 } }, { upsert: true });
    return { ok: true, content: 'All previous dashboard links are now invalid.' };
  },
});

import { z } from 'zod';
import { authUrl, disconnect, getConnection, GoogleNotConnected, missingScopes } from '../google.js';
import { defineTool } from './registry.js';

/** Turn "not connected" into guidance the model can relay, instead of a tool error. */
export async function withGoogle(fn: () => Promise<unknown>) {
  try {
    return { ok: true, content: JSON.stringify(await fn()) };
  } catch (err) {
    if (err instanceof GoogleNotConnected) return { ok: false, content: err.message };
    throw err;
  }
}

export const connectGoogle = defineTool({
  name: 'connect_google',
  description:
    'Give the owner a link to connect their Google account (Calendar: read and edit events; Tasks: read and edit to-dos; Gmail: read and write drafts, never send). The link works for 15 minutes.',
  input: z.object({}),
  async run(ctx) {
    const existing = await getConnection(ctx.c, ctx.owner);
    return {
      ok: true,
      content: JSON.stringify({
        url: await authUrl(ctx.owner),
        alreadyConnectedAs: existing?.email ?? null,
        note: 'Put the URL on its own line. Google will show an "unverified app" screen because this is a personal app: tap Advanced, then Continue, and leave every permission ticked.',
      }),
    };
  },
});

export const googleStatus = defineTool({
  name: 'google_status',
  description: 'Whether Google is connected, as which account, and whether any permission was left unticked.',
  input: z.object({}),
  async run(ctx) {
    const conn = await getConnection(ctx.c, ctx.owner);
    if (!conn) return { ok: true, content: JSON.stringify({ connected: false }) };
    const missing = missingScopes(conn);
    return { ok: true, content: JSON.stringify({ connected: true, email: conn.email, since: conn.connectedAt, ...(missing.length && { missingPermissions: missing, note: 'Some features will fail until they reconnect and tick everything.' }) }) };
  },
});

export const disconnectGoogle = defineTool({
  name: 'disconnect_google',
  description: 'Disconnect Google: revokes access at Google and deletes the stored credential.',
  input: z.object({}),
  async run(ctx) {
    return { ok: true, content: (await disconnect(ctx.c, ctx.owner)) ? 'Disconnected and access revoked.' : 'Google was not connected.' };
  },
});

export const GOOGLE_ACCOUNT_TOOLS = [connectGoogle, googleStatus, disconnectGoogle];

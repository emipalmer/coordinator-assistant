import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { createLogger, parseAllowlist } from '@app/core';
import { collections, getDb } from '../db.js';
import { mongoUri, outboundQueueUrl } from '../config.js';
import { completeConnection, coordinatorRef, verifyState } from '../google.js';
import { sendToCoordinator } from '../outbox.js';

const log = createLogger({ svc: 'google-callback' });

const page = (title: string, body: string, status = 200): APIGatewayProxyResultV2 => ({
  statusCode: status,
  headers: {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  },
  body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;padding:32px 16px;font:17px/1.5 -apple-system,system-ui,sans-serif;background:#fcfcfb;color:#0b0b0b;text-align:center}
@media (prefers-color-scheme:dark){body{background:#1a1a19;color:#f0efec}}h1{font-size:22px}</style>
<h1>${title}</h1><p>${body}</p>`,
});

// GET /google/callback?code=...&state=... (Google redirects here after the coordinator approves)
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const q = event.queryStringParameters ?? {};
  if (q.error) return page('Not connected', 'Google access was not granted. You can ask Tari for a new link any time.');
  const ref = await verifyState(q.state);
  // The state is signed and short-lived, and must map to a current coordinator: stops CSRF and replayed links.
  const coordinator = ref ? [...parseAllowlist(process.env.COORDINATOR_ALLOWLIST)].find((p) => coordinatorRef(p) === ref) : undefined;
  if (!coordinator || !q.code) {
    log.warn('google callback rejected');
    return page('Link expired', 'This connect link expired or is invalid. Text Tari "connect Google" for a fresh one.', 400);
  }
  try {
    const c = collections(await getDb(await mongoUri()));
    const conn = await completeConnection(c, coordinator, q.code);
    await sendToCoordinator(outboundQueueUrl(), [
      { to: coordinator, text: `Google is connected (${conn.email}). Shifts will go on a separate "Tari" calendar in your account (I can't touch your own calendars), I'll flag when you're busy, and I can put emails in your Gmail Drafts for you to send. Want me to add your upcoming shifts to the Tari calendar now?\nA. Yes\nB. Not now` },
    ]);
    log.info('google connected');
    return page('Connected', 'Tari is connected to your Google account. You can close this page and go back to Messages.');
  } catch (err) {
    log.error('google connect failed', { err: (err as Error).message });
    return page('Something went wrong', 'Tari could not finish connecting. Please ask for a new link and try again.', 500);
  }
}

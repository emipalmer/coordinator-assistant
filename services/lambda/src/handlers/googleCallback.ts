import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ASSISTANT_NAME, createLogger, parseAllowlist } from '@app/core';
import { collections, getDb, recordAssistantMessage } from '../db.js';
import { mongoUri, outboundQueueUrl } from '../config.js';
import { completeConnection, missingScopes, ownerRef, verifyState } from '../google.js';
import { sendToOwner } from '../outbox.js';

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

// GET /google/callback?code=...&state=... (Google redirects here after the owner approves)
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const q = event.queryStringParameters ?? {};
  if (q.error) return page('Not connected', `Google access was not granted. You can ask ${ASSISTANT_NAME} for a new link any time.`);
  const ref = await verifyState(q.state);
  // The state is signed and short-lived, and must map to an allowlisted number: stops CSRF and replayed links.
  const owner = ref ? [...parseAllowlist(process.env.ALLOWLIST)].find((p) => ownerRef(p) === ref) : undefined;
  if (!owner || !q.code) {
    log.warn('google callback rejected');
    return page('Link expired', `This connect link expired or is invalid. Text ${ASSISTANT_NAME} "connect Google" for a fresh one.`, 400);
  }
  try {
    const c = collections(await getDb(await mongoUri()));
    const conn = await completeConnection(c, owner, q.code);
    const missing = missingScopes(conn);
    const text = missing.length
      ? `Google is connected (${conn.email}), but a few permissions were left unticked, so some things won't work. Want a fresh link to fix that?\nA. Yes\nB. Not now`
      : `Google is connected (${conn.email}). I can now check and edit your calendar, keep your Google Tasks, search and read your email, and write drafts (I can't send). Try "what's on tomorrow?"`;
    await recordAssistantMessage(c, owner, text);
    await sendToOwner(outboundQueueUrl(), [{ to: owner, text }]);
    log.info('google connected', { missing: missing.length });
    return page('Connected', `${ASSISTANT_NAME} is connected to your Google account. You can close this page and go back to Messages.`);
  } catch (err) {
    log.error('google connect failed', { err: (err as Error).message });
    return page('Something went wrong', `${ASSISTANT_NAME} could not finish connecting. Please ask for a new link and try again.`, 500);
  }
}

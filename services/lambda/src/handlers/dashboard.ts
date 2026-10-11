import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { createLogger, verifyLink } from '@app/core';
import { collections, getDb } from '../db.js';
import { mongoUri } from '../config.js';
import { getSecret } from '../secrets.js';
import { requireEnv } from '../env.js';
import { dashboardData } from '../dashboard-data.js';
import { linkSubject } from '../tools/dashboard.js';
import { parseAllowlist } from '@app/core';
import { DASHBOARD_PAGE } from '../dashboard-page.js';

const log = createLogger({ svc: 'dashboard' });

// Volunteer data: never cached, never indexed, never leaked through the Referer of an outbound link.
const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

// GET /dashboard?t=...       -> the page (it fetches the JSON below with the same token)
// GET /dashboard/data?t=...  -> live data; this JSON shape is the contract for the dashboard design
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const denied = { statusCode: 401, headers: { ...SECURITY_HEADERS, 'content-type': 'text/plain' }, body: 'This link has expired or was revoked. Text Tari "dashboard" for a fresh one.' };
  const subject = verifyLink(await getSecret(requireEnv('DASHBOARD_SECRET_PARAM')), event.queryStringParameters?.t);
  if (!subject) return denied;
  const c = collections(await getDb(await mongoUri()));
  const settings = await c.settings.findOne({ _id: 'org' });
  if (!settings) return { statusCode: 503, body: 'not set up' };
  // The subject must belong to a current coordinator at the current link version (revocation).
  const version = settings.dashboardLinkVersion ?? 1;
  if (![...parseAllowlist(process.env.COORDINATOR_ALLOWLIST)].some((p) => linkSubject(p, version) === subject)) {
    log.warn('revoked or foreign dashboard link');
    return denied;
  }

  if (!event.rawPath.endsWith('/data')) {
    return { statusCode: 200, headers: { ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8' }, body: DASHBOARD_PAGE };
  }
  const data = await dashboardData(c, settings, new Date());
  log.info('dashboard served');
  return { statusCode: 200, headers: { ...SECURITY_HEADERS, 'content-type': 'application/json' }, body: JSON.stringify(data) };
}

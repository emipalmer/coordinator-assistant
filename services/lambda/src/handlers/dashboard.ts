import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { createLogger, parseAllowlist, verifyLink } from '@app/core';
import { collections, getDb } from '../db.js';
import { mongoUri } from '../config.js';
import { getSecret } from '../secrets.js';
import { requireEnv } from '../env.js';
import { consoleData } from '../console-data.js';
import { linkSubject } from '../tools/dashboard.js';

const log = createLogger({ svc: 'dashboard' });

// The coordinator console (apps/web) is copied next to this bundle at build time.
const WEB_ROOT = fileURLToPath(new URL('./web/', import.meta.url));

// Volunteer data: never cached, never indexed, never leaked through the Referer of an outbound link.
const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

const TYPES: Record<string, string> = { js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', woff2: 'font/woff2', ico: 'image/x-icon' };

// GET /dashboard?t=...                 the console (needs a valid link)
// GET /dashboard/console?t=...         live data for the console (needs a valid link)
// GET /dashboard/assets/<hashed file>  static JS/CSS, no data inside, so no token needed
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const path = event.rawPath.replace(/\/+$/, '');

  const asset = /^\/dashboard\/assets\/([\w.-]+)$/.exec(path);
  if (asset) {
    // The regex forbids "/" and "..", so this can't escape the assets folder.
    const file = `${WEB_ROOT}assets/${asset[1]}`;
    if (!existsSync(file)) return { statusCode: 404 };
    const ext = asset[1]!.split('.').pop()!;
    const binary = !['js', 'css', 'svg'].includes(ext);
    const body = readFileSync(file);
    return {
      statusCode: 200,
      headers: { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' },
      body: binary ? body.toString('base64') : body.toString('utf8'),
      isBase64Encoded: binary,
    };
  }

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

  if (path === '/dashboard/console') {
    log.info('console data served');
    return { statusCode: 200, headers: { ...SECURITY_HEADERS, 'content-type': 'application/json' }, body: JSON.stringify(await consoleData(c, settings, new Date())) };
  }
  if (path === '/dashboard') {
    return { statusCode: 200, headers: { ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8' }, body: readFileSync(`${WEB_ROOT}index.html`, 'utf8') };
  }
  return { statusCode: 404, headers: SECURITY_HEADERS };
}

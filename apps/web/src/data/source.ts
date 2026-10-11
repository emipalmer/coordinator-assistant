/**
 * The console's single data entry point.
 *
 * Deployed, the console is served at /dashboard?t=<signed link token> and reads live data from
 * /dashboard/console with the same token (see services/lambda/src/console-data.ts, which mirrors
 * ./types.ts). Locally (`npm run dev` without a token) it falls back to the synthetic fixtures,
 * which match `scripts/seed.ts`.
 */

import type { ConsoleData } from './types';

export async function loadConsoleData(): Promise<ConsoleData> {
  const token = new URLSearchParams(location.search).get('t');
  if (!token) {
    if (import.meta.env.DEV) return (await import('./fixtures')).fixtures;
    throw new Error('This console link is missing its access token. Text Tari "dashboard" for a new link.');
  }
  const res = await fetch(`${import.meta.env.BASE_URL}console?t=${encodeURIComponent(token)}`, { cache: 'no-store' });
  if (res.status === 401) throw new Error('This link has expired or was revoked. Text Tari "dashboard" for a fresh one.');
  if (!res.ok) throw new Error(`Console data failed: ${res.status}`);
  return (await res.json()) as ConsoleData;
}

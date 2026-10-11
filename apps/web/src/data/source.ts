/**
 * The console's single data entry point.
 *
 * Right now it returns synthetic fixtures that match `scripts/seed.ts` exactly
 * (same 14 volunteers, same shifts, same attendance totals), so the console
 * shows what a freshly seeded Atlas database holds.
 *
 * To go live, replace the body of `loadConsoleData` with a fetch against a
 * read-only endpoint and keep the return type. Nothing else in the app reads
 * fixtures directly.
 *
 *   export async function loadConsoleData(): Promise<ConsoleData> {
 *     const res = await fetch('/api/console');
 *     if (!res.ok) throw new Error(`Console data failed: ${res.status}`);
 *     return (await res.json()) as ConsoleData;
 *   }
 */

import type { ConsoleData } from './types';
import { fixtures } from './fixtures';

export async function loadConsoleData(): Promise<ConsoleData> {
  return fixtures;
}

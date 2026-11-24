import { PARAMS, parseIcs, type IcsEvent } from '@app/core';
import { getSecret } from './secrets.js';

// Canvas via the owner's personal Calendar Feed (.ics). Penn State doesn't let students make API tokens,
// so this is read-only due dates and course events: no grades, submission status, or announcements.
// The feed URL works like a password (anyone with it can read the calendar), so it lives in SSM.

export class CanvasNotConfigured extends Error {
  constructor() {
    super('Canvas is not set up yet: the owner needs to add their Canvas Calendar Feed link (see README, "Canvas").');
  }
}

const TTL_MS = 5 * 60_000;
const MAX_BYTES = 5 * 1024 * 1024;
let cache: { at: number; zone: string; events: IcsEvent[] } | undefined;

async function feedUrl(): Promise<URL> {
  let raw: string;
  try {
    raw = await getSecret(PARAMS.canvas);
  } catch {
    throw new CanvasNotConfigured();
  }
  const { feedUrl } = JSON.parse(raw) as { feedUrl?: string };
  if (!feedUrl) throw new CanvasNotConfigured();
  const url = new URL(feedUrl.replace(/^webcal:/i, 'https:'));
  if (url.protocol !== 'https:') throw new Error('Canvas feed URL must be https');
  return url;
}

/** All events in the feed, cached briefly per container (a turn often calls Canvas tools more than once). */
export async function canvasFeed(zone: string): Promise<IcsEvent[]> {
  if (cache && cache.zone === zone && Date.now() - cache.at < TTL_MS) return cache.events;
  const url = await feedUrl();
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10_000), headers: { accept: 'text/calendar' } });
  if (res.status === 404 || res.status === 401 || res.status === 403) {
    throw new Error('Canvas rejected the calendar feed link (it may have been reset). The owner needs to copy a fresh Calendar Feed link.');
  }
  if (!res.ok) throw new Error(`Canvas feed returned HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error('Canvas feed is unexpectedly large');
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Canvas feed link did not return a calendar');
  const events = parseIcs(text, zone);
  cache = { at: Date.now(), zone, events };
  return events;
}

export interface CanvasItem {
  id: string;
  kind: 'assignment' | 'event';
  title: string;
  course?: string;
  allDay: boolean;
  start: Date;
  date?: string;
  url?: string;
  location?: string;
  description?: string;
}

/** Canvas puts the course in brackets at the end of the title: "Homework 5 [STAT_200_001_FA26]". */
export function toCanvasItem(e: IcsEvent): CanvasItem {
  const m = /^(.*?)\s*\[([^\]]+)\]\s*$/.exec(e.summary);
  return {
    id: e.uid,
    kind: /assignment/i.test(e.uid) ? 'assignment' : 'event',
    title: m ? m[1]! : e.summary,
    course: m ? m[2]!.replace(/_/g, ' ') : undefined,
    allDay: e.allDay,
    start: e.start,
    ...(e.date && { date: e.date }),
    url: e.url,
    location: e.location,
    description: e.description,
  };
}

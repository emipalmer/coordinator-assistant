// Minimal iCalendar (RFC 5545) reader for subscription feeds such as Canvas's Calendar Feed.
// Handles line folding, escapes, all-day dates, UTC times, and TZID times. No recurrence (Canvas doesn't use it).
import { localToUtc } from './dates.js';

export interface IcsEvent {
  uid: string;
  summary: string;
  description?: string;
  url?: string;
  location?: string;
  /** True for date-only (VALUE=DATE) events. */
  allDay: boolean;
  /** YYYY-MM-DD for all-day events. */
  date?: string;
  /** Start instant. For all-day events, local midnight in the zone passed to parseIcs. */
  start: Date;
  end?: Date;
}

const unescape = (v: string) => v.replace(/\\([\\;,nN])/g, (_m, c: string) => (c === 'n' || c === 'N' ? '\n' : c));

interface Prop {
  params: Record<string, string>;
  value: string;
}

function parseLine(line: string): [string, Prop] | undefined {
  // NAME;PARAM=x;PARAM="y:z":value — the first colon outside quotes ends the name/params part.
  let inQuote = false;
  let i = 0;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ':' && !inQuote) break;
  }
  if (i >= line.length) return undefined;
  const [name, ...rawParams] = line.slice(0, i).split(';');
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return [name!.toUpperCase(), { params, value: line.slice(i + 1) }];
}

function parseWhen(p: Prop, zone: string): { allDay: boolean; date?: string; at: Date } | undefined {
  const v = p.value.trim();
  const d = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (d || p.params.VALUE === 'DATE') {
    if (!d) return undefined;
    const date = `${d[1]}-${d[2]}-${d[3]}`;
    return { allDay: true, date, at: localToUtc(date, zone) };
  }
  const t = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!t) return undefined;
  if (t[7]) return { allDay: false, at: new Date(Date.UTC(+t[1]!, +t[2]! - 1, +t[3]!, +t[4]!, +t[5]!, +t[6]!)) };
  // TZID times are wall-clock in that zone; floating times are taken as the owner's zone.
  let tz = p.params.TZID ?? zone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    tz = zone;
  }
  return { allDay: false, at: localToUtc(`${t[1]}-${t[2]}-${t[3]}T${t[4]}:${t[5]}`, tz) };
}

/** Parse VEVENTs from an .ics document. `zone` positions all-day and floating times. Malformed events are skipped. */
export function parseIcs(text: string, zone: string): IcsEvent[] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events: IcsEvent[] = [];
  let cur: Map<string, Prop> | undefined;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') cur = new Map();
    else if (line === 'END:VEVENT') {
      if (cur) {
        const ev = toEvent(cur, zone);
        if (ev) events.push(ev);
      }
      cur = undefined;
    } else if (cur) {
      const parsed = parseLine(line);
      // Keep the first occurrence of each property (VALARMs nested inside a VEVENT come later).
      if (parsed && !cur.has(parsed[0])) cur.set(parsed[0], parsed[1]);
    }
  }
  return events;
}

function toEvent(props: Map<string, Prop>, zone: string): IcsEvent | undefined {
  const startProp = props.get('DTSTART');
  const start = startProp && parseWhen(startProp, zone);
  if (!start) return undefined;
  const endProp = props.get('DTEND');
  const end = endProp && parseWhen(endProp, zone);
  const text = (k: string) => {
    const v = props.get(k)?.value;
    return v ? unescape(v).trim() || undefined : undefined;
  };
  return {
    uid: text('UID') ?? `${start.at.toISOString()}-${text('SUMMARY') ?? ''}`,
    summary: text('SUMMARY') ?? '(untitled)',
    description: text('DESCRIPTION'),
    url: text('URL'),
    location: text('LOCATION'),
    allDay: start.allDay,
    ...(start.date && { date: start.date }),
    start: start.at,
    ...(end && { end: end.at }),
  };
}

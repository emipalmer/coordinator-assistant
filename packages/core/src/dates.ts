// Wall-clock <-> UTC conversion for one IANA zone without a date library.

/** Offset (minutes, local minus UTC) of `zone` at instant `at`. */
export function zoneOffsetMinutes(zone: string, at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** Interpret "YYYY-MM-DDTHH:mm" (no offset) as wall time in `zone`. */
export function localToUtc(local: string, zone: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(local);
  if (!m) throw new Error(`Expected YYYY-MM-DD or YYYY-MM-DDTHH:mm, got "${local}"`);
  const guess = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0));
  // Two passes handle the DST edge where the offset at the guess differs from the offset at the answer.
  let utc = guess - zoneOffsetMinutes(zone, new Date(guess)) * 60000;
  utc = guess - zoneOffsetMinutes(zone, new Date(utc)) * 60000;
  return new Date(utc);
}

/** Calendar date (YYYY-MM-DD) of an instant in `zone`. */
export function localDate(at: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** Human-friendly local time for texts, e.g. "Sat Oct 17, 9:00 AM". */
export function formatLocal(at: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(at);
}

/** Context line for the system prompt so the model can resolve "Saturday" or "tomorrow". */
export function nowContext(now: Date, zone: string): string {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long' }).format(now);
  // Date only: a clock time would change every request and defeat prompt caching.
  return `Today is ${day}, ${localDate(now, zone)} (${zone}).`;
}

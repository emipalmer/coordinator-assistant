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
  return `Today is ${day}, ${localDate(now, zone)}; local time ${formatLocal(now, zone)} (${zone}).`;
}

/** Birthdays within the next `days` days (inclusive of today), soonest first. Feb 29 is celebrated Feb 28 in non-leap years. */
export function upcomingBirthdays<T extends { birthday?: { month: number; day: number } }>(
  people: T[], now: Date, zone: string, days: number,
): Array<{ person: T; date: string; inDays: number }> {
  const [y, mo, d] = localDate(now, zone).split('-').map(Number) as [number, number, number];
  const today = Date.UTC(y, mo - 1, d);
  const out: Array<{ person: T; date: string; inDays: number }> = [];
  for (const person of people) {
    if (!person.birthday) continue;
    for (const year of [y, y + 1]) {
      const { month, day } = person.birthday;
      const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
      const dd = month === 2 && day === 29 && !leap ? 28 : day;
      const when = Date.UTC(year, month - 1, dd);
      const inDays = Math.round((when - today) / 86_400_000);
      if (inDays >= 0) {
        if (inDays <= days) out.push({ person, date: new Date(when).toISOString().slice(0, 10), inDays });
        break;
      }
    }
  }
  return out.sort((a, b) => a.inDays - b.inDays);
}

/** Whole days since `last` (undefined means never active). */
export function daysSince(last: Date | undefined, now: Date): number | null {
  return last ? Math.floor((now.getTime() - last.getTime()) / 86_400_000) : null;
}

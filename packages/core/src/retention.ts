import { daysSince } from './dates.js';

export const LAPSED_AFTER_DAYS = 45;
export const CHECKIN_COOLDOWN_DAYS = 30;

/**
 * Volunteers worth a check-in: were active before, haven't shown up in `LAPSED_AFTER_DAYS`,
 * and haven't had a check-in drafted recently (so the morning text doesn't nag about the same people).
 */
export function pickLapsed<T extends { status: string; lastActiveAt?: Date; lastCheckInDraftAt?: Date }>(
  people: T[], now: Date, lapsedAfter = LAPSED_AFTER_DAYS, cooldown = CHECKIN_COOLDOWN_DAYS,
): Array<{ person: T; daysAway: number }> {
  return people
    .filter((p) => p.status !== 'onboarding')
    .map((p) => ({ person: p, daysAway: daysSince(p.lastActiveAt, now) }))
    .filter((x): x is { person: T; daysAway: number } => x.daysAway !== null && x.daysAway >= lapsedAfter)
    .filter((x) => { const since = daysSince(x.person.lastCheckInDraftAt, now); return since === null || since >= cooldown; })
    .sort((a, b) => a.daysAway - b.daysAway);
}

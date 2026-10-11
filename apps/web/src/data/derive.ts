/**
 * Pure selectors over `ConsoleData`.
 *
 * Every number the console shows is computed here rather than hardcoded in a
 * component, so the figures stay consistent with the roster and there is one
 * place to check the arithmetic. These mirror the rules the agent already
 * applies server-side:
 *   - "quiet" = no logged attendance for 45+ days (the daily check's threshold)
 *   - estimated value = hours x the org's hourly rate (Independent Sector 2026)
 *   - guardian consent only applies to minors
 */

import {
  COMPLIANCE_ITEMS,
  COMPLIANCE_LABELS,
  type Compliance,
  type ComplianceItem,
  type ConsoleData,
  type Shift,
  type Volunteer,
} from './types';

/** Days since an ISO date, relative to the console's "today". */
export function daysSince(isoDate: string, today: string): number {
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${isoDate}T00:00:00Z`);
  return Math.round((a - b) / 86_400_000);
}

export const QUIET_AFTER_DAYS = 45;

export function missingCompliance(c: Compliance): ComplianceItem[] {
  return COMPLIANCE_ITEMS.filter((k) => c[k].status === 'missing');
}

/** Items that actually apply to this person (guardian consent only for minors). */
export function applicableCompliance(c: Compliance): ComplianceItem[] {
  return COMPLIANCE_ITEMS.filter((k) => c[k].status !== 'not_required');
}

export function receivedCount(c: Compliance): number {
  return COMPLIANCE_ITEMS.filter((k) => c[k].status === 'received').length;
}

/** "waiver, emergency contact and guardian consent" — for a sentence. */
export function formatMissing(items: ComplianceItem[]): string {
  const labels = items.map((k) => COMPLIANCE_LABELS[k]);
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

export const isQuiet = (v: Volunteer, today: string): boolean =>
  v.lastActiveAt !== undefined && daysSince(v.lastActiveAt, today) >= QUIET_AFTER_DAYS;

export const openSlots = (s: Shift): number => Math.max(0, s.capacity - s.crew.length);

/** Birthdays falling in the next `window` days, ignoring year. */
export function upcomingBirthdays(data: ConsoleData, window = 7): Array<{ volunteer: Volunteer; inDays: number }> {
  const today = new Date(`${data.today}T00:00:00Z`);
  const out: Array<{ volunteer: Volunteer; inDays: number }> = [];
  for (const v of data.volunteers) {
    if (!v.birthday) continue;
    // Try this year and next, so late-December birthdays are still found in January.
    for (const year of [today.getUTCFullYear(), today.getUTCFullYear() + 1]) {
      const when = Date.UTC(year, v.birthday.month - 1, v.birthday.day);
      const inDays = Math.round((when - today.getTime()) / 86_400_000);
      if (inDays >= 0 && inDays <= window) {
        out.push({ volunteer: v, inDays });
        break;
      }
    }
  }
  return out.sort((a, b) => a.inDays - b.inDays);
}

export interface ImpactSummary {
  totalHours: number;
  estimatedValueUsd: number;
  volunteersServed: number;
  shiftsHeld: number;
  averagePerShift: number;
}

export function impactSummary(data: ConsoleData): ImpactSummary {
  const totalHours = round1(data.weeklyHours.reduce((s, w) => s + w.hours, 0));
  const shiftsHeld = data.weeklyHours.length;
  return {
    totalHours,
    // Round to cents only at the end, so the total equals hours x rate exactly.
    estimatedValueUsd: Math.round(totalHours * data.org.hourlyValueUsd * 100) / 100,
    volunteersServed: data.volunteers.filter((v) => v.totalHours > 0).length,
    shiftsHeld,
    averagePerShift: shiftsHeld ? round1(totalHours / shiftsHeld) : 0,
  };
}

export interface StatusCounts {
  active: number;
  onboarding: number;
  inactive: number;
}

export function statusCounts(data: ConsoleData): StatusCounts {
  return data.volunteers.reduce<StatusCounts>(
    (acc, v) => ({ ...acc, [v.status]: acc[v.status] + 1 }),
    { active: 0, onboarding: 0, inactive: 0 },
  );
}

export type TriageTone = 'urgent' | 'warn' | 'calm';

export interface TriageItem {
  id: string;
  count: number;
  tone: TriageTone;
  what: string;
  who: string;
}

/**
 * The "Needs you" list. Ordered by how much it blocks the coordinator:
 * paperwork stops a volunteer being scheduled at all, open slots are the next
 * deadline, then re-engagement, then the nice-to-dos.
 */
export function triage(data: ConsoleData): TriageItem[] {
  const { today } = data;

  const incomplete = data.volunteers.filter((v) => missingCompliance(v.compliance).length > 0);
  const missingItemCount = incomplete.reduce((s, v) => s + missingCompliance(v.compliance).length, 0);

  const shortShifts = data.upcoming.filter((s) => openSlots(s) > 0);
  const totalOpen = data.upcoming.reduce((s, sh) => s + openSlots(sh), 0);

  const quiet = data.volunteers
    .filter((v) => isQuiet(v, today))
    .sort((a, b) => daysSince(b.lastActiveAt!, today) - daysSince(a.lastActiveAt!, today));

  const birthdays = upcomingBirthdays(data);
  const minorsNeedingConsent = data.volunteers.filter(
    (v) => v.isMinor && v.compliance.guardianConsent.status === 'missing',
  );

  const items: TriageItem[] = [
    {
      id: 'paperwork',
      count: missingItemCount,
      tone: 'urgent',
      what: 'Paperwork items missing',
      who: `${firstNames(incomplete)} — ${incomplete.length === 1 ? 'cannot' : 'none can'} be scheduled yet`,
    },
    {
      id: 'open-slots',
      count: totalOpen,
      tone: 'urgent',
      what: `Open slots in the next ${data.upcoming.length} shifts`,
      who: shortShifts.map((s) => `${s.title} short ${openSlots(s)}`).join(' · ') || 'Every shift is full',
    },
    {
      id: 'quiet',
      count: quiet.length,
      tone: 'warn',
      what: `Quiet ${QUIET_AFTER_DAYS} days or more`,
      who: quiet.map((v) => `${firstName(v.name)} ${daysSince(v.lastActiveAt!, today)}d`).join(' · '),
    },
    {
      id: 'birthdays',
      count: birthdays.length,
      tone: 'calm',
      what: 'Birthdays this week',
      who: birthdays
        .map(({ volunteer, inDays }) => `${firstName(volunteer.name)} ${inDays === 0 ? 'today' : `in ${inDays}d`}`)
        .join(' · '),
    },
    {
      id: 'consent',
      count: minorsNeedingConsent.length,
      tone: 'calm',
      what: 'Minors needing guardian consent',
      who: minorsNeedingConsent.map((v) => v.name).join(' and '),
    },
  ];

  // An empty bucket is not news — don't make the coordinator read zeroes.
  return items.filter((i) => i.count > 0);
}

/**
 * The shift the coordinator should look at first: the soonest one that still
 * has open slots, falling back to the soonest shift overall.
 */
export function focusShift(data: ConsoleData): Shift | undefined {
  const sorted = [...data.upcoming].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.find((s) => openSlots(s) > 0) ?? sorted[0];
}

/**
 * Candidate suggestions for a shift's open slots: volunteers who are free at
 * that day and part of day, are not already on the crew, and have no blocking
 * paperwork. Required skills float to the top. This is the cheap local echo of
 * the agent's vector search — it explains *why* each name appears.
 */
export function suggestCandidates(data: ConsoleData, shift: Shift, limit = 3): Array<{ volunteer: Volunteer; reason: string }> {
  const day = dayOfWeek(shift.date);
  const part = partOfDay(shift.start);
  const onCrew = new Set(shift.crew);

  const free = data.volunteers.filter(
    (v) =>
      !onCrew.has(v.name) &&
      v.status !== 'inactive' &&
      missingCompliance(v.compliance).length === 0 &&
      v.availability.some((a) => a.day === day && a.part === part),
  );

  const scored = free.map((v) => {
    const matched = shift.requiredSkills.filter((s) => v.skills.includes(s));
    return {
      volunteer: v,
      score: matched.length,
      reason: matched.length
        ? `${firstName(v.name)} is ${matched.join(' / ')} certified`
        : `${firstName(v.name)} is free ${titleDay(day)} ${part}`,
    };
  });

  return scored
    .sort((a, b) => b.score - a.score || a.volunteer.name.localeCompare(b.volunteer.name))
    .slice(0, limit)
    .map(({ volunteer, reason }) => ({ volunteer, reason }));
}

// ---------- small formatting helpers ----------

const round1 = (n: number) => Math.round(n * 10) / 10;

export const firstName = (full: string): string => full.split(' ')[0] ?? full;
const firstNames = (vs: Volunteer[]): string => vs.map((v) => firstName(v.name)).join(', ');

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const DAY_TITLES: Record<string, string> = {
  sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
  thu: 'Thursday', fri: 'Friday', sat: 'Saturday',
};

export function dayOfWeek(isoDate: string): (typeof DAYS)[number] {
  const d = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  return DAYS[d]!;
}

export const titleDay = (d: string): string => DAY_TITLES[d] ?? d;

export function partOfDay(time24: string): 'morning' | 'afternoon' | 'evening' {
  const hour = Number(time24.slice(0, 2));
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

/** "5:00 PM" from "17:00". */
export function formatTime(time24: string): string {
  const h = Number(time24.slice(0, 2));
  const m = time24.slice(3, 5);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${suffix}`;
}

/** "Wednesday, October 14" */
export function formatLongDate(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
}

/** "Wed" / "14" for the little date block. */
export function dateParts(isoDate: string): { dow: string; dd: string } {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return {
    dow: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
    dd: String(d.getUTCDate()),
  };
}

/** "Aug 8" for chart ticks. */
export function formatShortDate(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

export function formatRelativeDays(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

export function formatLastSeen(v: Volunteer, today: string): string {
  if (!v.lastActiveAt) return 'Never';
  const d = daysSince(v.lastActiveAt, today);
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  return `${d} days ago`;
}

/** "Sat morning, Wed evening" */
export function formatAvailability(a: Volunteer['availability']): string {
  if (a.length === 0) return '—';
  return a.map((s) => `${s.day[0]!.toUpperCase()}${s.day.slice(1)} ${s.part}`).join(', ');
}

export const formatUsd = (n: number): string =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/**
 * View-model types for the console.
 *
 * These deliberately mirror the MongoDB document shapes in
 * `packages/core/src/models.ts` so that swapping the mock source for a live
 * read is a change in ONE module (`./source.ts`) and nothing else.
 *
 * Differences from the server models, and why:
 *  - Dates are ISO `YYYY-MM-DD` strings, not `Date`. The console only ever
 *    renders them, and strings serialise cleanly over an API boundary.
 *  - `ObjectId` is a plain `string` id.
 *  - Derived numbers the server computes on demand (hours per volunteer,
 *    fill counts) are precomputed here; see `./derive.ts`.
 */

export const COMPLIANCE_ITEMS = [
  'application',
  'waiver',
  'emergencyContact',
  'codeOfConduct',
  'guardianConsent',
] as const;

export type ComplianceItem = (typeof COMPLIANCE_ITEMS)[number];

/** Human labels for compliance keys — the coordinator never sees camelCase. */
export const COMPLIANCE_LABELS: Record<ComplianceItem, string> = {
  application: 'application',
  waiver: 'waiver',
  emergencyContact: 'emergency contact',
  codeOfConduct: 'code of conduct',
  guardianConsent: 'guardian consent',
};

export type ComplianceStatus = 'missing' | 'received' | 'not_required';

export type Compliance = Record<ComplianceItem, { status: ComplianceStatus }>;

export type VolunteerStatus = 'onboarding' | 'active' | 'inactive';

export type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type DayPart = 'morning' | 'afternoon' | 'evening';
export interface Availability {
  day: Day;
  part: DayPart;
}

export interface Volunteer {
  id: string;
  name: string;
  isMinor: boolean;
  /** Month/day only — the roster never stores a birth year. */
  birthday?: { month: number; day: number };
  availability: Availability[];
  skills: string[];
  interests: string[];
  notes: string;
  status: VolunteerStatus;
  /** ISO date of their last logged attendance; absent means never attended. */
  lastActiveAt?: string;
  compliance: Compliance;
  /** Sum of logged attendance hours over the seeded window. */
  totalHours: number;
}

export interface Shift {
  id: string;
  title: string;
  location?: string;
  /** ISO date, local to the org timezone. */
  date: string;
  /** 24h local times, e.g. "17:00". */
  start: string;
  end: string;
  capacity: number;
  requiredSkills: string[];
  description: string;
  /** Names of volunteers with a confirmed assignment. */
  crew: string[];
}

/** One past pantry session, used for the hours trend. */
export interface WeeklyHours {
  date: string;
  hours: number;
}

export interface OrgSettings {
  name: string;
  timezone: string;
  hourlyValueUsd: number;
  coordinatorName: string;
}

export interface ConsoleData {
  org: OrgSettings;
  /** "Today" as the console sees it, so the UI is deterministic in a demo. */
  today: string;
  volunteers: Volunteer[];
  upcoming: Shift[];
  weeklyHours: WeeklyHours[];
}

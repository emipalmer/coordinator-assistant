import { z } from 'zod';

export const Day = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
export const DayPart = z.enum(['morning', 'afternoon', 'evening']);
export const Availability = z.object({ day: Day, part: DayPart });
export type Availability = z.infer<typeof Availability>;

export const Birthday = z.object({ month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31) });
export type Birthday = z.infer<typeof Birthday>;

export const COMPLIANCE_ITEMS = ['application', 'waiver', 'emergencyContact', 'codeOfConduct', 'guardianConsent'] as const;
export const ComplianceItem = z.enum(COMPLIANCE_ITEMS);
export type ComplianceItem = z.infer<typeof ComplianceItem>;
export const ComplianceEntry = z.object({
  status: z.enum(['missing', 'received', 'not_required']),
  receivedAt: z.date().optional(),
  docKey: z.string().optional(), // S3 key of a photographed signed form
});
export type Compliance = Record<ComplianceItem, z.infer<typeof ComplianceEntry>>;

export const VolunteerStatus = z.enum(['onboarding', 'active', 'inactive']);

export interface Volunteer {
  name: string;
  nameLower: string; // case-insensitive lookups without a collation
  phone?: string;
  email?: string;
  birthday?: Birthday;
  isMinor: boolean;
  availability: Availability[];
  skills: string[];
  interests: string[];
  notes: string;
  notesEmbedding?: number[];
  status: z.infer<typeof VolunteerStatus>;
  lastActiveAt?: Date;
  lastCheckInDraftAt?: Date;
  compliance: Compliance;
  createdAt: Date;
  updatedAt: Date;
}

export interface Shift {
  title: string;
  location?: string;
  start: Date;
  end: Date;
  capacity: number;
  requiredSkills: string[];
  description: string;
  status: 'scheduled' | 'cancelled';
  createdAt: Date;
}

// Separate collection so a cancellation is a single status flip a change stream can match on.
export interface Assignment {
  shiftId: unknown;
  volunteerId: unknown;
  status: 'confirmed' | 'cancelled';
  createdAt: Date;
  cancelledAt?: Date;
}

export interface AttendanceRecord {
  volunteerId: unknown;
  shiftId?: unknown;
  date: Date;
  hours: number;
  activity: string | null;
  createdAt: Date;
}

export interface Settings {
  _id: 'org';
  orgName: string;
  timezone: string;
  hourlyValueUsd: number;
  coordinatorName?: string;
}

/** New volunteers start with everything missing; guardian consent only applies to minors. */
export function initialCompliance(isMinor: boolean): Compliance {
  return {
    application: { status: 'missing' },
    waiver: { status: 'missing' },
    emergencyContact: { status: 'missing' },
    codeOfConduct: { status: 'missing' },
    guardianConsent: { status: isMinor ? 'missing' : 'not_required' },
  };
}

export function missingCompliance(c: Compliance): ComplianceItem[] {
  return COMPLIANCE_ITEMS.filter((k) => c[k].status === 'missing');
}

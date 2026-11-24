/** The assistant's name: how it introduces itself, signs the OAuth pages, and names things it creates. */
export const ASSISTANT_NAME = 'Star';

export const DEFAULT_TIMEZONE = 'America/New_York';

/** The owner's profile and preferences, gathered by the first-conversation setup. One per allowlisted number. */
export interface OwnerProfile {
  _id: string; // E.164
  name?: string;
  timezone?: string; // IANA zone; DEFAULT_TIMEZONE when unset
  prefs: {
    replyLength?: 'brief' | 'detailed';
    emoji?: boolean;
    morningBriefing?: boolean;
    /** Texts the night before and 3 hours before Canvas deadlines (default on). */
    deadlineNudges?: boolean;
    /** Their usual day, local "HH:mm": meeting suggestions stay inside it. */
    dayStart?: string;
    dayEnd?: string;
    /** Place for weather, e.g. "State College, PA". */
    weatherPlace?: string;
    /** Which calendar each event category goes on (calendar ids); unset categories go on primary. */
    calendarFor?: Partial<Record<string, string>>;
    /** Capybara pics a day from the stash, at random times (0 = off). */
    capysPerDay?: number;
    /** Encouraging texts a day at random times (0 = off). */
    pepTalksPerDay?: number;
  };
  /** Durable facts the owner asked the assistant to remember ("my advisor is Dr. Lee"). */
  memories?: Array<{ id: string; text: string; at: Date }>;
  onboardedAt?: Date;
  createdAt: Date;
}

export const MAX_MEMORIES = 60;

/** Defaults when the owner hasn't said: usual day for meeting suggestions, and weather location. */
export const DEFAULT_DAY = { start: '09:00', end: '21:00' } as const;
export const DEFAULT_WEATHER_PLACE = 'State College, PA';
export const DEFAULT_CAPYS_PER_DAY = 3;
export const DEFAULT_PEP_TALKS_PER_DAY = 2;

import { MongoClient, type Db } from 'mongodb';
import { DB_NAME, type NudgeKind, type OwnerProfile, type Repeat } from '@app/core';

let client: MongoClient | undefined;

// Reused across warm Lambda invocations; a small pool is plenty for one person.
export async function getDb(uri: string): Promise<Db> {
  if (!client) {
    client = new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 8000, appName: 'personal-assistant' });
    await client.connect();
  }
  return client.db(DB_NAME);
}

export interface ConversationDoc {
  _id: string; // owner E.164
  turns: Array<{ role: 'user' | 'assistant'; text: string; at: Date }>;
}

export interface GoogleConnection {
  _id: string; // owner E.164
  email: string;
  refreshTokenSealed: string; // AES-256-GCM, key in SSM; never stored in plaintext
  scopes: string[];
  connectedAt: Date;
  /** Set when Google rejects the refresh token; the user is asked to reconnect. */
  expiredAt?: Date;
}

/** Something the owner asked to be reminded about. The ticker fires it; repeating ones roll forward. */
export interface ReminderDoc {
  _id: string; // 6 hex chars, shown to the model for cancel_reminder
  owner: string;
  text: string;
  dueAt: Date;
  repeat?: Repeat;
  status: 'pending' | 'sent' | 'cancelled';
  createdAt: Date;
  sentAt?: Date;
}

/** A Canvas assignment seen in the feed, with nudge bookkeeping and the owner's "done". */
export interface DeadlineDoc {
  _id: string; // `${owner}|${feed uid}`
  owner: string;
  uid: string;
  title: string;
  course?: string;
  due: Date;
  allDay: boolean;
  date: string;
  nudged: Partial<Record<NudgeKind, Date>>;
  doneAt?: Date;
  seenAt: Date;
}

/** One picture in the capybara stash (shared by every owner). Stocked from capy.lol or texted in by the owner. */
export interface CapyDoc {
  _id: string; // "capy-<capy.lol index>" or "own-<6 hex>"
  key: string; // S3 key under stash/
  alt?: string; // description of the photo (capy.lol's alt text)
  source: 'capy.lol' | 'owner';
  addedAt: Date;
  sends: number;
  lastSentAt?: Date;
  /** "Don't send that one again": kept so the stocker doesn't re-add it. */
  removedAt?: Date;
}

/** One day's random drop times (capybara pics or pep talks) for one owner; `done` holds the ones already sent or skipped. */
export interface DayPlanDoc {
  _id: string; // `${kind}|${owner}|${YYYY-MM-DD}`
  perDay: number;
  times: Date[];
  done: Date[];
}

export const collections = (db: Db) => ({
  conversations: db.collection<ConversationDoc>('conversations'),
  profiles: db.collection<OwnerProfile>('profiles'),
  googleConnections: db.collection<GoogleConnection>('googleConnections'),
  reminders: db.collection<ReminderDoc>('reminders'),
  deadlines: db.collection<DeadlineDoc>('deadlines'),
  capys: db.collection<CapyDoc>('capys'),
  dayPlans: db.collection<DayPlanDoc>('dayPlans'),
});
export type Collections = ReturnType<typeof collections>;

/**
 * Save a message sent outside a normal turn (e.g. from the Google sign-in callback) into the
 * thread, so a reply like "A" to its options has context.
 */
export async function recordAssistantMessage(c: Collections, owner: string, text: string) {
  await c.conversations.updateOne(
    { _id: owner },
    { $push: { turns: { $each: [{ role: 'assistant' as const, text, at: new Date() }], $slice: -40 } } },
    { upsert: true },
  );
}

/** Merge consecutive same-role turns: out-of-band messages can leave two assistant turns in a row. */
export function collapseTurns<T extends { role: 'user' | 'assistant'; text: string }>(turns: T[]): Array<Pick<T, 'role' | 'text'>> {
  const out: Array<Pick<T, 'role' | 'text'>> = [];
  for (const t of turns) {
    const last = out.at(-1);
    if (last && last.role === t.role) last.text = `${last.text}\n\n${t.text}`;
    else out.push({ role: t.role, text: t.text });
  }
  return out;
}

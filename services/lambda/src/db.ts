import { MongoClient, type Db } from 'mongodb';
import type { AttendanceRecord, Assignment, CoordinatorProfile, FormValues, Settings, Shift, Volunteer } from '@app/core';

let client: MongoClient | undefined;

// Reused across warm Lambda invocations; a small pool is plenty for one coordinator.
export async function getDb(uri: string): Promise<Db> {
  if (!client) {
    client = new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 8000, appName: 'coordinator-assistant' });
    await client.connect();
  }
  return client.db('coord');
}

export interface ConversationDoc {
  _id: string; // coordinator E.164
  turns: Array<{ role: 'user' | 'assistant'; text: string; at: Date }>;
  activeFormSubmissionId?: unknown;
}

export interface FormSubmission {
  templateId: string;
  coordinator: string;
  volunteerId?: unknown;
  values: FormValues;
  status: 'in_progress' | 'complete' | 'cancelled';
  pdfKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GoogleConnection {
  _id: string; // coordinator E.164
  email: string;
  refreshTokenSealed: string; // AES-256-GCM, key in SSM; never stored in plaintext
  scopes: string[];
  connectedAt: Date;
  /** The dedicated "Tari" calendar this app created in the coordinator's account. */
  calendarId?: string;
}

export const collections = (db: Db) => ({
  volunteers: db.collection<Volunteer>('volunteers'),
  shifts: db.collection<Shift>('shifts'),
  assignments: db.collection<Assignment>('assignments'),
  attendance: db.collection<AttendanceRecord>('attendance'),
  conversations: db.collection<ConversationDoc>('conversations'),
  settings: db.collection<Settings>('settings'),
  formSubmissions: db.collection<FormSubmission>('formSubmissions'),
  coordinators: db.collection<CoordinatorProfile>('coordinators'),
  googleConnections: db.collection<GoogleConnection>('googleConnections'),
});
export type Collections = ReturnType<typeof collections>;

/**
 * Save a message Tari sent outside a normal turn (e.g. from the Google sign-in callback) into the
 * thread, so a reply like "A" to its options has context.
 */
export async function recordAssistantMessage(c: Collections, coordinator: string, text: string) {
  await c.conversations.updateOne(
    { _id: coordinator },
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

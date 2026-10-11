import { MongoClient, type Db } from 'mongodb';
import type { AttendanceRecord, Assignment, Settings, Shift, Volunteer } from '@app/core';

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

export const collections = (db: Db) => ({
  volunteers: db.collection<Volunteer>('volunteers'),
  shifts: db.collection<Shift>('shifts'),
  assignments: db.collection<Assignment>('assignments'),
  attendance: db.collection<AttendanceRecord>('attendance'),
  conversations: db.collection<ConversationDoc>('conversations'),
  settings: db.collection<Settings>('settings'),
});
export type Collections = ReturnType<typeof collections>;

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

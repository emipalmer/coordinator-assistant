import { createHash } from 'node:crypto';
import { MongoClient, type ChangeStreamDocument, type ResumeToken } from 'mongodb';
import type { AgentEvent, Logger } from '@app/core';

const STATE_ID = 'assignments-cancellations';

/**
 * Watches for shift assignments flipping to "cancelled" and forwards each as an agent event.
 * Runs here rather than in Lambda because a change stream needs a long-lived connection.
 * The resume token is persisted so a bridge restart picks up cancellations it missed.
 */
export async function watchCancellations(uri: string, send: (e: AgentEvent) => Promise<void>, log: Logger) {
  const client = new MongoClient(uri, { appName: 'coordinator-bridge' });
  await client.connect();
  const db = client.db('coord');
  const state = db.collection<{ _id: string; resumeToken: ResumeToken }>('streamState');

  const pipeline = [{ $match: { operationType: 'update', 'updateDescription.updatedFields.status': 'cancelled' } }];

  const open = async () => {
    const saved = await state.findOne({ _id: STATE_ID });
    const stream = db.collection('assignments').watch(pipeline, saved ? { resumeAfter: saved.resumeToken } : {});
    log.info('change stream open', { resumed: Boolean(saved) });

    stream.on('change', async (change: ChangeStreamDocument) => {
      if (change.operationType !== 'update') return;
      const assignmentId = String(change.documentKey._id);
      try {
        // The change event id is unique per change, which makes it a natural SQS dedup id.
        await send({ kind: 'event', type: 'assignment_cancelled', eventId: hash(JSON.stringify(change._id)), assignmentId });
        await state.updateOne({ _id: STATE_ID }, { $set: { resumeToken: change._id } }, { upsert: true });
        log.info('cancellation forwarded', { assignmentId });
      } catch (err) {
        // Not saving the token means a restart replays this change.
        log.error('cancellation forward failed', { err, assignmentId });
      }
    });
    stream.on('error', async (err) => {
      log.error('change stream error, reopening', { err });
      await stream.close().catch(() => {});
      // A stale token (e.g. oplog rolled over) can't be resumed; start fresh rather than loop on errors.
      if (/resume/i.test(String(err))) await state.deleteOne({ _id: STATE_ID });
      setTimeout(() => void open(), 3_000);
    });
  };
  await open();
}

const hash = (s: string) => `cs-${createHash('sha256').update(s).digest('hex').slice(0, 40)}`;

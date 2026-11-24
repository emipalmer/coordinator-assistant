import { createHash } from 'node:crypto';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import {
  AgentEvent,
  CAPY_WINDOW,
  createLogger,
  DEFAULT_CAPYS_PER_DAY,
  DEFAULT_PEP_TALKS_PER_DAY,
  DEFAULT_TIMEZONE,
  formatLocal,
  localDate,
  nextOccurrence,
  nudgesDue,
  parseAllowlist,
  PEP_WINDOW,
  planDrops,
  type Logger,
  type NudgeKind,
} from '@app/core';
import { collections, getDb, recordAssistantMessage, type Collections, type DeadlineDoc } from '../db.js';
import { mongoUri, outboundQueueUrl } from '../config.js';
import { sendToOwner } from '../outbox.js';
import { capyFile, pickCapy, randomCaption, sentNote, stockStash } from '../capys.js';
import { requireEnv } from '../env.js';
import { CanvasNotConfigured } from '../canvas.js';
import { syncDeadlines } from '../deadlines.js';

// Runs every minute (EventBridge Scheduler). Cheap by design: a couple of Mongo queries, and the agent
// (and Claude) only gets involved when something is actually due. Canvas is re-read every 15 minutes.
const baseLog = createLogger({ svc: 'ticker' });
const sqs = new SQSClient({});
const owners = [...parseAllowlist(process.env.ALLOWLIST)];
const SYNC_EVERY_MIN = 15;
let lastSync = 0;

export async function handler() {
  const now = new Date();
  const c = collections(await getDb(await mongoUri()));
  const sync = Date.now() - lastSync >= (SYNC_EVERY_MIN - 1) * 60_000;
  if (sync) lastSync = Date.now();
  try {
    const added = await stockStash(c, baseLog);
    if (added) baseLog.info('capy stash stocked', { added });
  } catch (err) {
    baseLog.warn('capy stocking failed', { err });
  }
  for (const owner of owners) {
    const log = baseLog;
    const profile = await c.profiles.findOne({ _id: owner }, { projection: { timezone: 1, prefs: 1 } });
    const zone = profile?.timezone ?? DEFAULT_TIMEZONE;
    try {
      await fireReminders(c, owner, zone, now, log);
    } catch (err) {
      log.error('reminders failed', { err });
    }
    try {
      await fireCapys(c, owner, zone, now, profile?.prefs?.capysPerDay ?? DEFAULT_CAPYS_PER_DAY, log);
    } catch (err) {
      log.error('capy drop failed', { err });
    }
    try {
      await firePepTalk(c, owner, zone, now, profile?.prefs?.pepTalksPerDay ?? DEFAULT_PEP_TALKS_PER_DAY, log);
    } catch (err) {
      log.error('pep talk failed', { err });
    }
    if (profile?.prefs?.deadlineNudges === false) continue;
    try {
      if (sync) log.info('canvas synced', { items: await syncDeadlines(c, owner, zone, now) });
      await fireNudges(c, owner, zone, now, log);
    } catch (err) {
      if (!(err instanceof CanvasNotConfigured)) log.error('deadline nudges failed', { err });
    }
  }
}

async function enqueue(owner: string, event: AgentEvent) {
  AgentEvent.parse(event);
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: requireEnv('INBOUND_QUEUE_URL'),
      MessageBody: JSON.stringify(event),
      MessageGroupId: owner,
      MessageDeduplicationId: createHash('sha256').update(event.eventId).digest('hex'),
    }),
  );
}

/** Claim every due reminder (repeating ones roll forward), then hand them to the agent as one text. */
async function fireReminders(c: Collections, owner: string, zone: string, now: Date, log: Logger) {
  const claimed: Array<{ id: string; text: string; dueAt: Date; repeat?: string }> = [];
  for (let i = 0; i < 20; i++) {
    const r = await c.reminders.findOne({ owner, status: 'pending', dueAt: { $lte: now } }, { sort: { dueAt: 1 } });
    if (!r) break;
    const next = r.repeat ? { dueAt: nextOccurrence(r.dueAt, r.repeat, zone, now) } : { status: 'sent' as const, sentAt: now };
    const won = await c.reminders.updateOne({ _id: r._id, status: 'pending', dueAt: r.dueAt }, { $set: next });
    if (won.modifiedCount) claimed.push({ id: r._id, text: r.text, dueAt: r.dueAt, repeat: r.repeat });
  }
  if (!claimed.length) return;
  try {
    await enqueue(owner, {
      kind: 'event',
      type: 'reminder',
      eventId: `reminder-${claimed.map((r) => `${r.id}@${r.dueAt.getTime()}`).join(',')}`,
      to: owner,
      items: claimed.map((r) => ({ id: r.id, text: r.text, due: formatLocal(r.dueAt, zone) })),
    });
    log.info('reminders fired', { n: claimed.length });
  } catch (err) {
    // Put them back so the next tick retries.
    for (const r of claimed) await c.reminders.updateOne({ _id: r.id }, { $set: { status: 'pending', dueAt: r.dueAt }, $unset: { sentAt: '' } });
    throw err;
  }
}

const dueLabel = (d: DeadlineDoc, zone: string) =>
  d.allDay ? `${new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${d.date}T00:00:00Z`))} (end of day)` : formatLocal(d.due, zone);

async function fireNudges(c: Collections, owner: string, zone: string, now: Date, log: Logger) {
  const upcoming = await c.deadlines.find({ owner, doneAt: { $exists: false }, due: { $gt: now, $lt: new Date(now.getTime() + 2 * 86_400_000) } }).toArray();
  const items: Array<{ id: string; title: string; course?: string; due: string; which: NudgeKind }> = [];
  for (const d of upcoming) {
    const kinds = nudgesDue(d, d.nudged ?? {}, now, zone);
    let which: NudgeKind | undefined;
    for (const k of kinds) {
      const won = await c.deadlines.updateOne({ _id: d._id, [`nudged.${k}`]: { $exists: false } }, { $set: { [`nudged.${k}`]: now } });
      if (won.modifiedCount) which = which === 'soon' ? 'soon' : k;
    }
    if (which) items.push({ id: d.uid, title: d.title, ...(d.course && { course: d.course }), due: dueLabel(d, zone), which });
  }
  if (!items.length) return;
  await enqueue(owner, { kind: 'event', type: 'deadline_nudge', eventId: `nudge-${items.map((i) => `${i.id}:${i.which}`).join(',')}`, to: owner, items: items.slice(0, 20) });
  log.info('deadline nudges', { n: items.length });
}

/** A drop that couldn't go out on time (outage) is skipped rather than sent late. */
const DROP_GRACE_MS = 30 * 60_000;

/**
 * Random daily drops: plan the day's times on its first tick (re-plan the rest of the day if the
 * owner changed how many), then claim each when its time comes. True when one should go out now.
 * Missed ones are claimed too, so they're skipped rather than sent late.
 */
async function dropDue(c: Collections, kind: 'capy' | 'pep', owner: string, zone: string, now: Date, perDay: number, window: { start: string; end: string }) {
  const today = localDate(now, zone);
  const id = `${kind}|${owner}|${today}`;
  let day = await c.dayPlans.findOne({ _id: id });
  if (!day || day.perDay !== perDay) {
    const done = day?.done ?? [];
    const times = [...done, ...planDrops(today, perDay - done.length, zone, now, Math.random, window)];
    await c.dayPlans.updateOne({ _id: id }, { $set: { perDay, times, done } }, { upsert: true });
    day = { _id: id, perDay, times, done };
  }
  const due = day.times.filter((t) => t <= now && !day!.done.some((d) => d.getTime() === t.getTime()));
  let fire = false;
  for (const t of due) {
    const won = await c.dayPlans.updateOne({ _id: id, done: { $ne: t } }, { $push: { done: t } });
    if (won.modifiedCount && now.getTime() - t.getTime() < DROP_GRACE_MS) fire = true;
  }
  return fire;
}

/** Capybara pics go straight to the outbound queue with a canned caption: no LLM involved. */
async function fireCapys(c: Collections, owner: string, zone: string, now: Date, perDay: number, log: Logger) {
  if (!(await dropDue(c, 'capy', owner, zone, now, perDay, CAPY_WINDOW))) return;
  const doc = await pickCapy(c, now);
  if (!doc) return;
  const caption = randomCaption();
  await sendToOwner(outboundQueueUrl(), [{ to: owner, attachment: await capyFile(doc) }, { to: owner, text: caption }]);
  await recordAssistantMessage(c, owner, `${sentNote(doc)} ${caption}`);
  log.info('capy sent', { id: doc._id });
}

/** Pep talks go through the agent, so they can be personal and mention what's coming up next. */
async function firePepTalk(c: Collections, owner: string, zone: string, now: Date, perDay: number, log: Logger) {
  if (!(await dropDue(c, 'pep', owner, zone, now, perDay, PEP_WINDOW))) return;
  await enqueue(owner, { kind: 'event', type: 'pep_talk', eventId: `pep-${localDate(now, zone)}-${now.getTime()}`, to: owner });
  log.info('pep talk queued');
}

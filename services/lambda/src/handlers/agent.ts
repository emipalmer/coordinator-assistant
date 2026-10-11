import type { SQSEvent } from 'aws-lambda';
import { AgentEvent, createLogger, InboundMessage, parseAllowlist, splitReply, type Logger, type Settings } from '@app/core';
import { sendToCoordinator } from '../outbox.js';
import { collections, getDb, type Collections } from '../db.js';
import { loadToolLoop, mongoUri, outboundQueueUrl } from '../config.js';
import { systemPrompt } from '../prompt.js';
import { ALL_TOOLS } from '../tools/index.js';
import { createExecutor, toToolDefs } from '../tools/registry.js';
import { describeCancellation } from '../tools/proactive.js';
import type { ToolLoop } from '../llm.js';

const baseLog = createLogger({ svc: 'agent' });
const HISTORY_TURNS = 12;
const toolDefs = toToolDefs(ALL_TOOLS);
const coordinators = [...parseAllowlist(process.env.COORDINATOR_ALLOWLIST)];
let loop: ToolLoop | undefined;

export const DEFAULT_SETTINGS: Settings = { _id: 'org', orgName: 'Maple Street Community Pantry', timezone: 'America/New_York', hourlyValueUsd: 34.79 };

export async function handler(event: SQSEvent) {
  for (const record of event.Records) {
    const body = JSON.parse(record.body);
    const asEvent = AgentEvent.safeParse(body);
    if (asEvent.success) {
      await handleEvent(asEvent.data, baseLog.child({ eventId: asEvent.data.eventId, type: asEvent.data.type }));
      continue;
    }
    const msg = InboundMessage.parse(body);
    const log = baseLog.child({ messageId: msg.messageId });
    try {
      await runTurn(msg.from, msg.text || (msg.attachments.length ? '(sent an attachment)' : ''), log);
    } catch (err) {
      log.error('agent failed', { err });
      // Tell the coordinator instead of going silent; don't rethrow, or SQS would redeliver and double-apply tools.
      await sendToCoordinator(outboundQueueUrl(), [{ to: msg.from, text: 'Sorry, something went wrong on my end. Could you send that again?' }]);
    }
  }
}

/**
 * Proactive work reuses the normal conversation path with a synthetic instruction, so the
 * coordinator can reply naturally ("send Maria's tomorrow instead") with full context.
 */
async function handleEvent(event: AgentEvent, log: Logger) {
  const c = await getCollections();
  let instruction: string;
  if (event.type === 'daily_check') {
    instruction =
      '[Scheduled morning check] Call daily_check. Text the coordinator a short good-morning summary: birthdays today (with a [[draft]] each), birthdays later this week (just list), and check-ins for volunteers we have not seen in a while (with a [[draft]] each). If there is nothing, say so in one line.';
  } else {
    const facts = await describeCancellation(toolCtx(c, log, coordinators[0] ?? ''), event.assignmentId);
    if (!facts) return log.info('cancellation needs no backfill');
    instruction = `[Automatic alert] ${facts.volunteer} just dropped out of ${facts.shiftTitle} (${facts.when}, shift id ${facts.shiftId}); ${facts.openSpots} spot(s) now open. Tell the coordinator in one line, call suggest_backfill for that shift, list the top candidates with a short reason each, and write one [[draft]] invite for the best fit.`;
  }
  for (const to of coordinators) {
    try {
      await runTurn(to, instruction, log.child({ to }));
    } catch (err) {
      log.error('event turn failed', { err });
    }
  }
}

async function getCollections() {
  return collections(await getDb(await mongoUri()));
}

const toolCtx = (c: Collections, log: Logger, coordinator: string, timezone = DEFAULT_SETTINGS.timezone) => ({ c, log, now: new Date(), timezone, coordinator });

async function runTurn(from: string, userText: string, log: Logger) {
  const c = await getCollections();
  loop ??= await loadToolLoop();
  const settings = (await c.settings.findOne({ _id: 'org' })) ?? DEFAULT_SETTINGS;
  const now = new Date();
  const convo = await c.conversations.findOne({ _id: from });
  const history = (convo?.turns ?? []).slice(-HISTORY_TURNS).map(({ role, text }) => ({ role, text }));
  // History must start with a user turn.
  while (history[0]?.role === 'assistant') history.shift();

  const execute = createExecutor(ALL_TOOLS, toolCtx(c, log, from, settings.timezone));
  const reply = await loop({ system: systemPrompt(settings, now), history, user: userText, tools: toolDefs, execute, log });

  await c.conversations.updateOne(
    { _id: from },
    { $push: { turns: { $each: [{ role: 'user' as const, text: userText, at: now }, { role: 'assistant' as const, text: reply, at: new Date() }], $slice: -40 } } },
    { upsert: true },
  );
  const bubbles = splitReply(reply);
  await sendToCoordinator(outboundQueueUrl(), bubbles.map((text) => ({ to: from, text })));
  log.info('replied', { bubbles: bubbles.length });
}

import type { SQSEvent } from 'aws-lambda';
import { createLogger, InboundMessage, splitReply, type Settings } from '@app/core';
import { sendToCoordinator } from '../outbox.js';
import { collections, getDb } from '../db.js';
import { loadToolLoop, mongoUri, outboundQueueUrl } from '../config.js';
import { systemPrompt } from '../prompt.js';
import { ALL_TOOLS } from '../tools/index.js';
import { createExecutor, toToolDefs } from '../tools/registry.js';
import type { ToolLoop } from '../llm.js';

const baseLog = createLogger({ svc: 'agent' });
const HISTORY_TURNS = 12;
const toolDefs = toToolDefs(ALL_TOOLS);
let loop: ToolLoop | undefined;

export const DEFAULT_SETTINGS: Settings = { _id: 'org', orgName: 'Maple Street Community Pantry', timezone: 'America/New_York', hourlyValueUsd: 34.79 };

export async function handler(event: SQSEvent) {
  for (const record of event.Records) {
    const msg = InboundMessage.parse(JSON.parse(record.body));
    const log = baseLog.child({ messageId: msg.messageId });
    try {
      await handleMessage(msg, log);
    } catch (err) {
      log.error('agent failed', { err });
      // Tell the coordinator instead of going silent; don't rethrow, or SQS would redeliver and double-apply tools.
      await sendToCoordinator(outboundQueueUrl(), [{ to: msg.from, text: "Sorry, something went wrong on my end. Could you send that again?" }]);
    }
  }
}

async function handleMessage(msg: InboundMessage, log: ReturnType<typeof createLogger>) {
  const c = collections(await getDb(await mongoUri()));
  loop ??= await loadToolLoop();
  const settings = (await c.settings.findOne({ _id: 'org' })) ?? DEFAULT_SETTINGS;
  const now = new Date();
  const convo = await c.conversations.findOne({ _id: msg.from });
  const history = (convo?.turns ?? []).slice(-HISTORY_TURNS).map(({ role, text }) => ({ role, text }));
  // History must start with a user turn.
  while (history[0]?.role === 'assistant') history.shift();

  const userText = msg.text || (msg.attachments.length ? '(sent an attachment)' : '');
  const execute = createExecutor(ALL_TOOLS, { c, log, now, timezone: settings.timezone, coordinator: msg.from });
  const reply = await loop({ system: systemPrompt(settings, now), history, user: userText, tools: toolDefs, execute, log });

  await c.conversations.updateOne(
    { _id: msg.from },
    { $push: { turns: { $each: [{ role: 'user' as const, text: userText, at: now }, { role: 'assistant' as const, text: reply, at: new Date() }], $slice: -40 } } },
    { upsert: true },
  );
  await sendToCoordinator(outboundQueueUrl(), splitReply(reply).map((text) => ({ to: msg.from, text })));
  log.info('replied', { bubbles: splitReply(reply).length });
}

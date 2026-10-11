// Demo fallback / test helper: send a coordinator message straight to the ingress API (skipping
// BlueBubbles) and print the agent's reply from MongoDB. Same agent, same tools.
//   npx tsx --env-file=.env scripts/say.ts "Who's missing paperwork?"
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { sign, SIGNATURE_HEADER, TIMESTAMP_HEADER, type InboundMessage } from '@app/core';

const text = process.argv.slice(2).join(' ');
if (!text) throw new Error('usage: say.ts "<message>"');
const from = process.env.COORDINATOR_ALLOWLIST!.split(',')[0]!.trim();
const mongo = new MongoClient(process.env.MONGODB_URI!);
const convos = mongo.db('coord').collection<{ _id: string; turns: Array<{ role: string; text: string }> }>('conversations');
const before = (await convos.findOne({ _id: from }))?.turns.length ?? 0;

const msg: InboundMessage = { messageId: `say-${randomUUID()}`, from, chatGuid: `iMessage;-;${from}`, text, attachments: [], receivedAt: new Date().toISOString() };
const body = JSON.stringify(msg);
const ts = String(Date.now());
const res = await fetch(process.env.INGRESS_URL!, {
  method: 'POST',
  headers: { 'content-type': 'application/json', [TIMESTAMP_HEADER]: ts, [SIGNATURE_HEADER]: sign(process.env.BRIDGE_SHARED_SECRET!, ts, body) },
  body,
});
if (!res.ok) throw new Error(`ingress ${res.status}`);

const started = Date.now();
for (;;) {
  const turns = (await convos.findOne({ _id: from }))?.turns ?? [];
  // The agent appends the user turn and its reply together.
  if (turns.length >= Math.min(before + 2, 40) && turns.at(-2)?.text.endsWith(text)) {
    console.log(`(${((Date.now() - started) / 1000).toFixed(1)}s)\n${turns.at(-1)!.text}`);
    break;
  }
  if (Date.now() - started > 120_000) throw new Error('no reply within 2 minutes');
  await new Promise((r) => setTimeout(r, 1000));
}
await mongo.close();

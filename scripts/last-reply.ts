// Dev helper: print the latest assistant reply.
//   npx tsx --env-file=.env scripts/last-reply.ts [+1XXXXXXXXXX]
import { MongoClient } from 'mongodb';
import { DB_NAME } from '@app/core';
const phone = process.argv[2] ?? process.env.ALLOWLIST!.split(',')[0]!.trim();
const c = new MongoClient(process.env.MONGODB_URI!);
const d = await c.db(DB_NAME).collection<{ _id: string; turns: Array<{ role: string; text: string }> }>('conversations').findOne({ _id: phone });
console.log(d?.turns.at(-1)?.text ?? '(no conversation)');
await c.close();

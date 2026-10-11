// Dev helper: print the latest assistant reply for a coordinator.
//   npx tsx --env-file=.env scripts/last-reply.ts [+1XXXXXXXXXX]
import { MongoClient } from 'mongodb';
const phone = process.argv[2] ?? process.env.COORDINATOR_ALLOWLIST!.split(',')[0]!.trim();
const c = new MongoClient(process.env.MONGODB_URI!);
const d = await c.db('coord').collection<{ _id: string; turns: Array<{ role: string; text: string }> }>('conversations').findOne({ _id: phone });
console.log(d?.turns.at(-1)?.text ?? '(no conversation)');
await c.close();

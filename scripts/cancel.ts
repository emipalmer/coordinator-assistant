// Demo helper: simulate a volunteer dropping out of their next shift by flipping the assignment directly
// in MongoDB (as any other system would). The change stream does the rest.
//   npx tsx --env-file=.env scripts/cancel.ts "Ben Okafor"
import { MongoClient, ObjectId } from 'mongodb';

const name = process.argv[2];
if (!name) throw new Error('usage: cancel.ts "<volunteer name>"');
const client = new MongoClient(process.env.MONGODB_URI!);
const db = client.db('coord');
const v = await db.collection('volunteers').findOne({ nameLower: name.toLowerCase() });
if (!v) throw new Error(`no volunteer ${name}`);
const upcoming = await db.collection('shifts').find({ start: { $gte: new Date() }, status: 'scheduled' }).sort({ start: 1 }).toArray();
const a = await db.collection('assignments').findOne({ volunteerId: v._id, status: 'confirmed', shiftId: { $in: upcoming.map((s) => s._id as ObjectId) } });
if (!a) throw new Error(`${name} has no upcoming confirmed shift`);
await db.collection('assignments').updateOne({ _id: a._id }, { $set: { status: 'cancelled', cancelledAt: new Date() } });
console.log(`cancelled ${name} from ${upcoming.find((s) => s._id.equals(a.shiftId))?.title}`);
await client.close();

// One-off migration: delete shift events Tari created on coordinators' *primary* calendars,
// before moving to a dedicated Tari calendar. Only touches events Tari recorded creating.
//   npx tsx --env-file=.env scripts/remove-primary-calendar-events.ts
import { collections, getDb } from '../services/lambda/src/db.js';
import { googleApi } from '../services/lambda/src/google.js';

const c = collections(await getDb(process.env.MONGODB_URI!));
let removed = 0;
for (const s of await c.shifts.find({ googleEvents: { $exists: true } }).toArray()) {
  for (const [coordinator, eventId] of Object.entries(s.googleEvents ?? {})) {
    try {
      await googleApi(c, coordinator, 'DELETE', `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`);
      removed++;
    } catch (err) {
      console.warn(`could not delete ${s.title}: ${(err as Error).message}`);
    }
  }
  await c.shifts.updateOne({ _id: s._id }, { $unset: { googleEvents: '' } });
}
console.log(`removed ${removed} event(s) from primary calendars`);
process.exit(0);

import { addDays, localDate, localToUtc } from '@app/core';
import { canvasFeed, toCanvasItem } from './canvas.js';
import type { Collections } from './db.js';

const DAY = 86_400_000;

/**
 * Copy upcoming Canvas assignments from the feed into Mongo so the ticker can time nudges and remember
 * which ones the owner marked done. Due dates are refreshed on every sync (instructors move them).
 */
export async function syncDeadlines(c: Collections, owner: string, zone: string, now: Date): Promise<number> {
  const items = (await canvasFeed(zone)).map(toCanvasItem).filter((i) => i.kind === 'assignment');
  let n = 0;
  for (const i of items) {
    const date = i.date ?? localDate(i.start, zone);
    // All-day items are due by the end of that day.
    const due = i.allDay ? new Date(localToUtc(addDays(date, 1), zone).getTime() - 60_000) : i.start;
    if (due.getTime() < now.getTime() - DAY || due.getTime() > now.getTime() + 14 * DAY) continue;
    await c.deadlines.updateOne(
      { _id: `${owner}|${i.id}` },
      { $set: { owner, uid: i.id, title: i.title, ...(i.course && { course: i.course }), due, allDay: i.allDay, date, seenAt: now }, $setOnInsert: { nudged: {} } },
      { upsert: true },
    );
    n++;
  }
  // Old rows aren't needed once they're well past due.
  await c.deadlines.deleteMany({ owner, due: { $lt: new Date(now.getTime() - 30 * DAY) } });
  return n;
}

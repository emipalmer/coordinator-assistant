import type { ObjectId } from 'mongodb';
import { localDate, type Settings } from '@app/core';
import type { Collections } from './db.js';

// Mirrors apps/web/src/data/types.ts (ConsoleData). That file is the contract; keep these in step.
// Deliberately excludes phone numbers, emails, incident reports and photos: the console is reached
// by a link, so it carries only what the coordinator's overview needs.

const hhmm = (d: Date, tz: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);

export async function consoleData(c: Collections, settings: Settings, now: Date) {
  const tz = settings.timezone;
  const [vols, totals, shifts, sessions, coordinatorProfile] = await Promise.all([
    c.volunteers.find({}, { projection: { notesEmbedding: 0, phone: 0, email: 0 } }).sort({ name: 1 }).toArray(),
    c.attendance.aggregate<{ _id: ObjectId; hours: number }>([{ $group: { _id: '$volunteerId', hours: { $sum: '$hours' } } }]).toArray(),
    c.shifts.find({ start: { $gte: now }, status: 'scheduled' }).sort({ start: 1 }).limit(20).toArray(),
    c.attendance
      .aggregate<{ _id: string; hours: number }>([
        { $match: { date: { $lt: now } } },
        { $group: { _id: { $dateToString: { date: '$date', format: '%Y-%m-%d', timezone: tz } }, hours: { $sum: '$hours' } } },
        { $sort: { _id: -1 } },
        { $limit: 10 },
      ])
      .toArray(),
    c.coordinators.findOne({}, { projection: { name: 1 } }),
  ]);
  const hours = new Map(totals.map((t) => [String(t._id), t.hours]));
  const names = new Map(vols.map((v) => [String(v._id), v.name]));
  const crews = new Map<string, string[]>();
  for (const a of await c.assignments.find({ shiftId: { $in: shifts.map((s) => s._id) }, status: 'confirmed' }).toArray()) {
    const key = String(a.shiftId);
    crews.set(key, [...(crews.get(key) ?? []), names.get(String(a.volunteerId)) ?? 'Unknown']);
  }

  return {
    org: {
      name: settings.orgName,
      timezone: tz,
      hourlyValueUsd: settings.hourlyValueUsd,
      coordinatorName: coordinatorProfile?.name ?? settings.coordinatorName ?? 'Coordinator',
    },
    today: localDate(now, tz),
    volunteers: vols.map((v) => ({
      id: String(v._id),
      name: v.name,
      isMinor: v.isMinor,
      ...(v.birthday && { birthday: v.birthday }),
      availability: v.availability,
      skills: v.skills,
      interests: v.interests,
      notes: v.notes,
      status: v.status,
      ...(v.lastActiveAt && { lastActiveAt: localDate(v.lastActiveAt, tz) }),
      compliance: Object.fromEntries(Object.entries(v.compliance).map(([k, e]) => [k, { status: e.status }])),
      totalHours: Math.round((hours.get(String(v._id)) ?? 0) * 10) / 10,
    })),
    upcoming: shifts.map((s) => ({
      id: String(s._id),
      title: s.title,
      ...(s.location && { location: s.location }),
      date: localDate(s.start, tz),
      start: hhmm(s.start, tz),
      end: hhmm(s.end, tz),
      capacity: s.capacity,
      requiredSkills: s.requiredSkills,
      description: s.description,
      crew: crews.get(String(s._id)) ?? [],
    })),
    weeklyHours: sessions.reverse().map((s) => ({ date: s._id, hours: Math.round(s.hours * 10) / 10 })),
  };
}

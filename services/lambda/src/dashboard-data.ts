import type { ObjectId } from 'mongodb';
import { formatLocal, localDate, localToUtc, missingCompliance, pickLapsed, upcomingBirthdays, type Settings } from '@app/core';
import type { Collections } from './db.js';
import { periodKeys } from './tools/charts.js';

/**
 * Everything the live dashboard shows, computed fresh on each request. The shape is the contract
 * for the dashboard design: keep it stable and additive.
 */
export async function dashboardData(c: Collections, settings: Settings, now: Date) {
  const tz = settings.timezone;
  const today = localDate(now, tz);
  const yearAgo = localDate(new Date(now.getTime() - 335 * 86_400_000), tz);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

  const [vols, monthly, recent, shifts] = await Promise.all([
    c.volunteers.find({}, { projection: { notesEmbedding: 0 } }).toArray(),
    c.attendance
      .aggregate<{ _id: Date; hours: number; volunteers: unknown[] }>([
        { $match: { date: { $gte: localToUtc(`${yearAgo.slice(0, 7)}-01`, tz) } } },
        { $group: { _id: { $dateTrunc: { date: '$date', unit: 'month', timezone: tz } }, hours: { $sum: '$hours' }, volunteers: { $addToSet: '$volunteerId' } } },
      ])
      .toArray(),
    c.attendance
      .aggregate<{ _id: ObjectId; hours: number }>([
        { $match: { date: { $gte: new Date(now.getTime() - 90 * 86_400_000) } } },
        { $group: { _id: '$volunteerId', hours: { $sum: '$hours' } } },
        { $sort: { hours: -1 } },
        { $limit: 10 },
      ])
      .toArray(),
    c.shifts.find({ start: { $gte: now }, status: 'scheduled' }).sort({ start: 1 }).limit(10).toArray(),
  ]);
  const names = new Map(vols.map((v) => [String(v._id), v.name]));
  const byMonth = new Map(monthly.map((m) => [localDate(m._id, tz), m]));
  const hoursByMonth = periodKeys(yearAgo, today, 'month').map((k) => ({
    month: k.slice(0, 7),
    hours: round1(byMonth.get(k)?.hours ?? 0),
    volunteers: byMonth.get(k)?.volunteers.length ?? 0,
  }));
  const hoursThisMonth = hoursByMonth.at(-1)?.hours ?? 0;
  const hoursLastMonth = hoursByMonth.at(-2)?.hours ?? 0;

  const upcomingShifts = await Promise.all(
    shifts.map(async (s) => {
      const confirmed = await c.assignments.find({ shiftId: s._id, status: 'confirmed' }).toArray();
      return {
        id: String(s._id),
        title: s.title,
        start: s.start.toISOString(),
        when: formatLocal(s.start, tz),
        location: s.location ?? null,
        capacity: s.capacity,
        filled: confirmed.length,
        open: Math.max(0, s.capacity - confirmed.length),
        volunteers: confirmed.map((a) => names.get(String(a.volunteerId)) ?? 'Unknown'),
      };
    }),
  );

  const missing = vols
    .filter((v) => v.status !== 'inactive')
    .map((v) => ({ name: v.name, items: missingCompliance(v.compliance) }))
    .filter((v) => v.items.length);

  return {
    org: { name: settings.orgName, timezone: tz, hourlyValueUsd: settings.hourlyValueUsd },
    generatedAt: now.toISOString(),
    kpis: {
      hoursThisMonth,
      hoursLastMonth,
      valueThisMonthUsd: Math.round(hoursThisMonth * settings.hourlyValueUsd * 100) / 100,
      activeVolunteers30d: vols.filter((v) => v.lastActiveAt && v.lastActiveAt >= thirtyDaysAgo).length,
      totalVolunteers: vols.length,
      onboarding: vols.filter((v) => v.status === 'onboarding').length,
      openSpotsNext7d: upcomingShifts.filter((s) => new Date(s.start).getTime() < now.getTime() + 7 * 86_400_000).reduce((n, s) => n + s.open, 0),
    },
    hoursByMonth,
    topVolunteers90d: recent.map((r) => ({ name: names.get(String(r._id)) ?? 'Unknown', hours: round1(r.hours) })),
    upcomingShifts,
    paperwork: { complete: vols.length - missing.length, missing },
    birthdays14d: upcomingBirthdays(vols, now, tz, 14).map((b) => ({ name: b.person.name, date: b.date, inDays: b.inDays })),
    needsCheckIn: pickLapsed(vols, now, 45, 0).slice(0, 10).map((l) => ({ name: l.person.name, daysSinceLastShift: l.daysAway })),
  };
}
export type DashboardData = Awaited<ReturnType<typeof dashboardData>>;

const round1 = (n: number) => Math.round(n * 10) / 10;

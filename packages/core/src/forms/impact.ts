/** Monthly hours/impact numbers, computed purely from attendance records. */

export interface ImpactInput {
  attendance: Array<{ volunteerId: string; date: Date; hours: number; activity?: string | null }>;
  volunteers: Array<{ id: string; name: string; createdAt: Date }>;
  shiftsHeld: number;
  hourlyValueUsd: number;
  monthStart: Date; // inclusive, UTC instant of local month start
  monthEnd: Date; // exclusive
}

export interface ImpactReport {
  totalHours: number;
  shiftsHeld: number;
  activeVolunteers: number;
  newVolunteers: number;
  estimatedValueUsd: number;
  hourlyValueUsd: number;
  avgHoursPerVolunteer: number;
  byActivity: Array<{ activity: string; hours: number }>;
  topVolunteers: Array<{ name: string; hours: number }>;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function computeImpact(i: ImpactInput): ImpactReport {
  const inMonth = i.attendance.filter((a) => a.date >= i.monthStart && a.date < i.monthEnd);
  const totalHours = inMonth.reduce((s, a) => s + a.hours, 0);
  const perVolunteer = new Map<string, number>();
  const perActivity = new Map<string, number>();
  for (const a of inMonth) {
    perVolunteer.set(a.volunteerId, (perVolunteer.get(a.volunteerId) ?? 0) + a.hours);
    const act = a.activity || 'general';
    perActivity.set(act, (perActivity.get(act) ?? 0) + a.hours);
  }
  const names = new Map(i.volunteers.map((v) => [v.id, v.name]));
  return {
    totalHours: round1(totalHours),
    shiftsHeld: i.shiftsHeld,
    activeVolunteers: perVolunteer.size,
    newVolunteers: i.volunteers.filter((v) => v.createdAt >= i.monthStart && v.createdAt < i.monthEnd).length,
    // Rounded to cents only at the end so the total matches hours x rate exactly.
    estimatedValueUsd: Math.round(totalHours * i.hourlyValueUsd * 100) / 100,
    hourlyValueUsd: i.hourlyValueUsd,
    avgHoursPerVolunteer: perVolunteer.size ? round1(totalHours / perVolunteer.size) : 0,
    byActivity: [...perActivity].map(([activity, hours]) => ({ activity, hours: round1(hours) })).sort((a, b) => b.hours - a.hours),
    topVolunteers: [...perVolunteer]
      .map(([id, hours]) => ({ name: names.get(id) ?? 'Unknown', hours: round1(hours) }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 5),
  };
}

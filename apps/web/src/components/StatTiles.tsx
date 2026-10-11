import type { ConsoleData } from '../data/types';
import { formatUsd, impactSummary } from '../data/derive';
import { HoursChart } from './HoursChart';

interface Props {
  data: ConsoleData;
}

/**
 * Impact figures over the seeded window. Deliberately labelled "last 10
 * weeks" rather than "this month": the calendar month to date holds only one
 * session, and a headline number that understates the work is worse than a
 * slightly longer window honestly labelled.
 */
export function StatTiles({ data }: Props) {
  const impact = impactSummary(data);

  const tiles = [
    { value: String(impact.totalHours), label: 'Volunteer hours', note: `last ${impact.shiftsHeld} weeks`, tone: 'green' },
    { value: formatUsd(impact.estimatedValueUsd), label: 'Estimated value', note: `at $${data.org.hourlyValueUsd.toFixed(2)} / hour`, tone: 'orange' },
    { value: String(impact.volunteersServed), label: 'Volunteers served', note: `of ${data.volunteers.length} on the roster`, tone: 'tan' },
    { value: String(impact.shiftsHeld), label: 'Shifts held', note: 'Saturday pantry', tone: 'tan' },
  ] as const;

  return (
    <section className="tiles" aria-label="Impact summary">
      {tiles.map((t) => (
        <div className="tile" key={t.label}>
          <span className={`pill ${t.tone}`}>{t.note}</span>
          <p className="value">{t.value}</p>
          <p className="label">{t.label}</p>
        </div>
      ))}

      <HoursChart weeks={data.weeklyHours} average={impact.averagePerShift} />
    </section>
  );
}

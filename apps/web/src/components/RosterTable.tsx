import type { ConsoleData, Volunteer } from '../data/types';
import {
  formatAvailability,
  formatLastSeen,
  isQuiet,
  missingCompliance,
  statusCounts,
} from '../data/derive';

interface Props {
  data: ConsoleData;
  /** Free-text filter from the top bar; matches name, skills and interests. */
  query: string;
}

const STATUS_PILL: Record<Volunteer['status'], string> = {
  active: 'green',
  onboarding: 'orange',
  inactive: 'tan',
};

/** Most recently seen first; never-attended volunteers sort to the bottom. */
function byRecency(a: Volunteer, b: Volunteer): number {
  if (!a.lastActiveAt && !b.lastActiveAt) return a.name.localeCompare(b.name);
  if (!a.lastActiveAt) return 1;
  if (!b.lastActiveAt) return -1;
  return b.lastActiveAt.localeCompare(a.lastActiveAt);
}

export function RosterTable({ data, query }: Props) {
  const counts = statusCounts(data);
  const q = query.trim().toLowerCase();

  const rows = data.volunteers
    .filter((v) =>
      q === ''
        ? true
        : [v.name, ...v.skills, ...v.interests].some((field) => field.toLowerCase().includes(q)),
    )
    .sort(byRecency);

  return (
    <section className="roster" aria-labelledby="roster-title">
      <div className="roster-head">
        <h2 id="roster-title">Volunteer roster</h2>
        <span className="pill green">{counts.active} active</span>
        <span className="pill orange">{counts.onboarding} onboarding</span>
        <span className="pill tan">{counts.inactive} inactive</span>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Volunteer</th>
              <th scope="col">Status</th>
              <th scope="col" className="num">Hours</th>
              <th scope="col">Last seen</th>
              <th scope="col">Available</th>
              <th scope="col">Skills</th>
              <th scope="col">Paperwork</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => {
              const missing = missingCompliance(v.compliance);
              const quiet = isQuiet(v, data.today);
              return (
                <tr key={v.id}>
                  <td className="name">
                    {v.name}
                    {v.isMinor && <span className="sr-only"> (minor)</span>}
                  </td>
                  <td>
                    <span className={`pill ${STATUS_PILL[v.status]}`}>
                      {v.status[0]!.toUpperCase() + v.status.slice(1)}
                    </span>
                  </td>
                  <td className="num">{v.totalHours.toFixed(1)}</td>
                  <td className={quiet ? 'quiet' : undefined}>{formatLastSeen(v, data.today)}</td>
                  <td>{formatAvailability(v.availability)}</td>
                  <td>{v.skills.length ? v.skills.join(', ') : '—'}</td>
                  <td className={missing.length ? 'pw-missing' : undefined}>
                    {missing.length ? `${missing.length} missing` : 'Complete'}
                  </td>
                </tr>
              );
            })}

            {rows.length === 0 && (
              <tr>
                <td colSpan={7}>No volunteer matches “{query}”. Try a name, a skill or an interest.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="roster-foot">
        Hours come from attendance the coordinator logged by text. Estimated value uses the Independent Sector
        2026 rate of ${data.org.hourlyValueUsd.toFixed(2)}/hour, the same rate as the board impact report. Demo
        data is synthetic.
      </p>
    </section>
  );
}

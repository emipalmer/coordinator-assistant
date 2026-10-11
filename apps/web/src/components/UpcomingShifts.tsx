import type { Shift } from '../data/types';
import { dateParts, formatTime, openSlots } from '../data/derive';

interface Props {
  shifts: Shift[];
}

export function UpcomingShifts({ shifts }: Props) {
  return (
    <section className="card" aria-labelledby="shifts-title">
      <div className="section-head">
        <h2 id="shifts-title">Upcoming shifts</h2>
        <span className="meta">Next 7 days</span>
      </div>

      <div className="stack-list">
        {shifts.map((s) => {
          const open = openSlots(s);
          const { dow, dd } = dateParts(s.date);
          const skillNote = s.requiredSkills.length ? `needs ${s.requiredSkills.join(', ')}` : 'no skills needed';
          return (
            <article className="shift-row" key={s.id}>
              <div className="date-block">
                <p className="dow">{dow}</p>
                <p className="dd">{dd}</p>
              </div>

              <div className="body">
                <p className="name">{s.title}</p>
                <p className="meta">
                  {formatTime(s.start)}–{formatTime(s.end)} · {skillNote}
                </p>
              </div>

              <div className="meter">
                <p className={`num${open > 0 ? ' short' : ''}`}>
                  {s.crew.length} / {s.capacity} — {open > 0 ? 'short' : 'full'}
                </p>
                <div
                  className="track"
                  role="img"
                  aria-label={`${s.crew.length} of ${s.capacity} slots filled`}
                >
                  <div
                    className={`fill${open > 0 ? ' short' : ''}`}
                    style={{ width: `${(s.crew.length / s.capacity) * 100}%` }}
                  />
                </div>
              </div>
            </article>
          );
        })}

        {shifts.length === 0 && <p className="meta">No shifts scheduled. Text the assistant to add one.</p>}
      </div>
    </section>
  );
}

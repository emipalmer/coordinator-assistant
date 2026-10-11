import type { ConsoleData, Shift } from '../data/types';
import {
  daysSince,
  formatRelativeDays,
  formatShortDate,
  formatTime,
  openSlots,
  suggestCandidates,
} from '../data/derive';

interface Props {
  data: ConsoleData;
  shift: Shift;
}

/**
 * The hero. The question a coordinator opens this screen to answer is "is the
 * next shift covered, and if not who can I ask" — so the card leads with the
 * fill count and names a concrete candidate against every open slot.
 */
export function NextShiftCard({ data, shift }: Props) {
  const open = openSlots(shift);
  const inDays = -daysSince(shift.date, data.today);
  const suggestions = suggestCandidates(data, shift, open);
  const weekday = new Date(`${shift.date}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    timeZone: 'UTC',
  });

  return (
    <section className="card shift-card" aria-labelledby="next-shift-title">
      <div className="head">
        <span className={`pill ${open > 0 ? 'orange' : 'green'}`}>{formatRelativeDays(inDays)}</span>
        <span className="when">
          {weekday}, {formatShortDate(shift.date)} · {formatTime(shift.start)}–{formatTime(shift.end)}
        </span>
      </div>

      <h2 id="next-shift-title">{shift.title}</h2>
      <p className="where">
        {shift.location ?? 'Location to confirm'} · {shift.description.toLowerCase()}
      </p>

      <div className="capacity">
        <p className="count">
          <strong className={open === 0 ? 'full' : undefined}>
            {shift.crew.length} of {shift.capacity}
          </strong>{' '}
          slots filled
        </p>
        <div className="slots" role="img" aria-label={`${shift.crew.length} of ${shift.capacity} slots filled`}>
          {Array.from({ length: shift.capacity }, (_, i) => (
            <span key={i} className={`slot${i < shift.crew.length ? ' filled' : ''}`} />
          ))}
        </div>
      </div>

      <div className="crew">
        {shift.crew.map((name) => (
          <div className="crew-row" key={name}>
            <span className="pip" aria-hidden />
            <div className="body">
              <p className="who">{name}</p>
              <p className="hint">Confirmed</p>
            </div>
            <span className="pill green">Confirmed</span>
          </div>
        ))}

        {Array.from({ length: open }, (_, i) => {
          const suggestion = suggestions[i];
          const needsSkill = i === 0 && shift.requiredSkills.length > 0;
          return (
            <div className="crew-row open" key={`open-${i}`}>
              <span className="pip" aria-hidden />
              <div className="body">
                <p className="who">{needsSkill ? `Open — ${shift.requiredSkills.join(', ')} needed` : 'Open'}</p>
                <p className="hint">{suggestion ? suggestion.reason : 'No one else is free at this time'}</p>
              </div>
              <span className="pill orange">Suggest</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

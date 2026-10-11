import type { WeeklyHours } from '../data/types';
import { formatShortDate } from '../data/derive';

interface Props {
  weeks: WeeklyHours[];
  average: number;
}

/**
 * Hours logged per past pantry session.
 *
 * One series, so there is no legend — the heading names it. Sessions at or
 * below 60% of the average are drawn in terracotta, which is the signal the
 * coordinator cares about (turnout slipping), and every bar carries its exact
 * value on hover and in its accessible label. The same numbers appear in the
 * roster table, so the chart is never the only way to read them.
 */
export function HoursChart({ weeks, average }: Props) {
  const max = Math.max(...weeks.map((w) => w.hours), 1);
  const lowThreshold = average * 0.6;
  const trend = weeks.length >= 2 && weeks[weeks.length - 1]!.hours < weeks[0]!.hours;

  return (
    <div className="tile tile-chart">
      <div className="chart-head">
        <div className="title">
          Hours per Saturday pantry
          <p className="sub">
            {average} average{trend ? ' · trending down' : ''}
          </p>
        </div>
        <span className="pill tan">{weeks.length} wks</span>
      </div>

      <div className="bars">
        {weeks.map((w) => {
          const label = `${formatShortDate(w.date)} — ${w.hours} hours`;
          return (
            <div className="bar-col" key={w.date} tabIndex={0} role="img" aria-label={label}>
              <span className="bar-tip" aria-hidden>
                {label}
              </span>
              <div
                className={`bar${w.hours <= lowThreshold ? ' low' : ''}`}
                style={{ height: `${Math.max(5, (w.hours / max) * 100)}%` }}
              />
            </div>
          );
        })}
      </div>

      <div className="x-axis" aria-hidden>
        {weeks.map((w, i) => (
          <span key={w.date}>{i % 2 === 0 ? formatShortDate(w.date) : ''}</span>
        ))}
      </div>
    </div>
  );
}

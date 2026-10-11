import type { ComponentType } from 'react';
import { CalendarIcon, ChartIcon, FormsIcon, HomeIcon, PeopleIcon } from './Icons';

export type SectionId = 'today' | 'volunteers' | 'shifts' | 'paperwork' | 'impact';

interface NavEntry {
  id: SectionId;
  label: string;
  icon: ComponentType<{ size?: number }>;
}

const NAV: NavEntry[] = [
  { id: 'today', label: 'Today', icon: HomeIcon },
  { id: 'volunteers', label: 'Volunteers', icon: PeopleIcon },
  { id: 'shifts', label: 'Shifts', icon: CalendarIcon },
  { id: 'paperwork', label: 'Paperwork', icon: FormsIcon },
  { id: 'impact', label: 'Impact', icon: ChartIcon },
];

interface Props {
  current: SectionId;
  onNavigate: (id: SectionId) => void;
  /** Count of volunteers with missing paperwork, shown as a badge. */
  paperworkCount: number;
}

/**
 * On desktop this is the left rail; under 760px the same markup becomes a
 * bottom tab bar (see the media query in app.css). Sections scroll into view
 * rather than routing, because the console is a single screen.
 */
export function Sidebar({ current, onNavigate, paperworkCount }: Props) {
  return (
    <nav className="sidebar" aria-label="Sections">
      <div className="brand">
        <span className="brand-mark" aria-hidden>M</span>
        <span>
          <span className="brand-name">Maple Street</span>
          <br />
          <span className="brand-sub">Community Pantry</span>
        </span>
      </div>

      <div className="nav">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className="nav-item"
            aria-current={current === id ? 'page' : undefined}
            onClick={() => onNavigate(id)}
          >
            <Icon />
            <span className="label">{label}</span>
            {id === 'paperwork' && paperworkCount > 0 && (
              <span className="nav-badge">
                {paperworkCount}
                <span className="sr-only"> volunteers with missing paperwork</span>
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="sidebar-spacer" />

      <div className="assistant-card">
        <p className="head">
          <span className="live" aria-hidden />
          Assistant is live
        </p>
        <p>Text it like a colleague. It updates this roster as you go.</p>
      </div>
    </nav>
  );
}

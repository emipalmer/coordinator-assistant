import { SearchIcon } from './Icons';
import { formatLongDate } from '../data/derive';

interface Props {
  today: string;
  volunteerCount: number;
  coordinatorName: string;
  query: string;
  onQueryChange: (q: string) => void;
}

export function TopBar({ today, volunteerCount, coordinatorName, query, onQueryChange }: Props) {
  return (
    <header className="topbar">
      <div>
        <h1>Today</h1>
        <p className="today-sub">
          {formatLongDate(today)} · {volunteerCount} volunteers on the roster
        </p>
      </div>

      <div className="grow" />

      <div className="search">
        <SearchIcon />
        <label className="sr-only" htmlFor="roster-search">
          Search volunteers or shifts
        </label>
        <input
          id="roster-search"
          type="search"
          placeholder="Search volunteers or shifts"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </div>

      <button type="button" className="btn-primary">
        Log hours
      </button>

      <span className="avatar" title={coordinatorName} aria-label={`Signed in as ${coordinatorName}`}>
        {coordinatorName.slice(0, 1)}
      </span>
    </header>
  );
}

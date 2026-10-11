import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConsoleData } from './data/types';
import { loadConsoleData } from './data/source';
import { focusShift, missingCompliance, triage } from './data/derive';
import { Sidebar, type SectionId } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { NextShiftCard } from './components/NextShiftCard';
import { NeedsYou } from './components/NeedsYou';
import { StatTiles } from './components/StatTiles';
import { UpcomingShifts } from './components/UpcomingShifts';
import { PaperworkPanel } from './components/PaperworkPanel';
import { RosterTable } from './components/RosterTable';

export default function App() {
  const [data, setData] = useState<ConsoleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<SectionId>('today');
  const [query, setQuery] = useState('');

  // Anchors for the nav; the console is one screen, so nav scrolls rather than routes.
  const anchors = {
    today: useRef<HTMLDivElement>(null),
    volunteers: useRef<HTMLDivElement>(null),
    shifts: useRef<HTMLDivElement>(null),
    paperwork: useRef<HTMLDivElement>(null),
    impact: useRef<HTMLDivElement>(null),
  } as const;

  useEffect(() => {
    loadConsoleData().then(setData).catch((e: unknown) => setError(String(e)));
  }, []);

  const derived = useMemo(() => {
    if (!data) return null;
    return {
      items: triage(data),
      shift: focusShift(data),
      paperworkCount: data.volunteers.filter((v) => missingCompliance(v.compliance).length > 0).length,
    };
  }, [data]);

  function navigate(id: SectionId) {
    setSection(id);
    anchors[id].current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (error) {
    return (
      <div className="shell">
        <div className="card">
          <h1>Roster unavailable</h1>
          <p className="panel-foot">{error}</p>
        </div>
      </div>
    );
  }

  if (!data || !derived) {
    return (
      <div className="shell">
        <div className="card">
          <p>Loading the roster…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <a className="skip-link" href="#console-main">
        Skip to roster
      </a>

      <div className="app-window">
        <Sidebar current={section} onNavigate={navigate} paperworkCount={derived.paperworkCount} />

        <main className="main" id="console-main" tabIndex={-1}>
          <div ref={anchors.today} />
          <TopBar
            today={data.today}
            volunteerCount={data.volunteers.length}
            coordinatorName={data.org.coordinatorName}
            query={query}
            onQueryChange={setQuery}
          />

          <div className="hero">
            {derived.shift ? (
              <NextShiftCard data={data} shift={derived.shift} />
            ) : (
              <section className="card">
                <h2>No upcoming shifts</h2>
                <p className="panel-foot">Text the assistant to schedule one.</p>
              </section>
            )}
            <NeedsYou items={derived.items} />
          </div>

          <div ref={anchors.impact} />
          <StatTiles data={data} />

          <div className="columns">
            <div ref={anchors.shifts}>
              <UpcomingShifts shifts={data.upcoming} />
            </div>
            <div ref={anchors.paperwork}>
              <PaperworkPanel volunteers={data.volunteers} totalCount={data.volunteers.length} />
            </div>
          </div>

          <div ref={anchors.volunteers} />
          <RosterTable data={data} query={query} />
        </main>
      </div>
    </div>
  );
}

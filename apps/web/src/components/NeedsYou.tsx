import type { TriageItem } from '../data/derive';

interface Props {
  items: TriageItem[];
}

/** Triage list, ordered by how hard each item blocks the coordinator. */
export function NeedsYou({ items }: Props) {
  return (
    <section className="card" aria-labelledby="needs-you-title">
      <div className="section-head">
        <h2 id="needs-you-title">Needs you</h2>
        <span className="meta">
          {items.length} {items.length === 1 ? 'thing' : 'things'}
        </span>
      </div>

      <div className="triage">
        {items.map((item) => (
          <div className="triage-item" key={item.id}>
            <span className={`tally ${item.tone}`} aria-hidden>
              {item.count}
            </span>
            <div>
              <p className="what">{item.what}</p>
              <p className="who">{item.who}</p>
            </div>
          </div>
        ))}

        {items.length === 0 && <p className="who">Nothing is waiting on you. The roster is clear.</p>}
      </div>
    </section>
  );
}

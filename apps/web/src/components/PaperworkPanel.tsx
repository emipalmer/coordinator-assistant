import { COMPLIANCE_ITEMS, COMPLIANCE_LABELS, type Volunteer } from '../data/types';
import { applicableCompliance, formatMissing, missingCompliance, receivedCount } from '../data/derive';

interface Props {
  volunteers: Volunteer[];
  totalCount: number;
}

/**
 * Who still owes paperwork, and exactly what.
 *
 * The five dots map one-to-one onto COMPLIANCE_ITEMS in a fixed order, so the
 * same position always means the same form. A hollow terracotta ring is
 * missing, a filled green dot is received, and grey means the item does not
 * apply (guardian consent for an adult). The written sentence above carries
 * the same information, so the dots never have to be decoded.
 */
export function PaperworkPanel({ volunteers, totalCount }: Props) {
  const incomplete = volunteers.filter((v) => missingCompliance(v.compliance).length > 0);
  const cleared = totalCount - incomplete.length;

  return (
    <section className="card" aria-labelledby="paperwork-title">
      <div className="section-head">
        <h2 id="paperwork-title">Paperwork</h2>
        <span className="meta">
          {incomplete.length} of {totalCount} incomplete
        </span>
      </div>

      <div className="stack-list">
        {incomplete.map((v) => {
          const missing = missingCompliance(v.compliance);
          const applicable = applicableCompliance(v.compliance);
          return (
            <article className="pw-row" key={v.id}>
              <div className="head">
                <p className="name">{v.name}</p>
                {v.isMinor && <span className="pill tan">Minor</span>}
                <p className="ratio">
                  {receivedCount(v.compliance)} / {applicable.length}
                </p>
              </div>

              <p className="need">Missing {formatMissing(missing)}.</p>

              <div className="dots">
                {COMPLIANCE_ITEMS.map((item) => {
                  const status = v.compliance[item].status;
                  const state = status === 'received' ? 'got' : status === 'missing' ? 'miss' : 'na';
                  return (
                    <span
                      key={item}
                      className={`dot ${state}`}
                      title={`${COMPLIANCE_LABELS[item]}: ${status.replace('_', ' ')}`}
                    />
                  );
                })}
                <span className="legend">{receivedCount(v.compliance)} received</span>
              </div>
            </article>
          );
        })}

        {incomplete.length === 0 && <p className="meta">Every volunteer is cleared to be scheduled.</p>}
      </div>

      <p className="panel-foot">
        <strong>{cleared} volunteers</strong> are fully cleared. Text a photo of a signed form — the assistant
        reads the name, marks the sections received, and files it here.
      </p>
    </section>
  );
}

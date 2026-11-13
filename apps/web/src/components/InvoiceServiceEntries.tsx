import { billableMinutes, formatDuration } from "@haben/core";
import { formatDate } from "../lib/format.ts";

export interface ProofEntry {
  id: string;
  workedOn: string;
  minutes: number;
  billableMinutes: number | null;
  nonBillable: boolean;
  description: string;
  project: string;
}

/** Nachweis auf der Rechnung (#417): die Leistungen, aus denen sie entstanden ist, mit Tag, abrechenbarer Dauer und Tätigkeit */
export function InvoiceServiceEntries({ entries }: { entries: ProofEntry[] }) {
  if (entries.length === 0) return null;
  const total = entries.reduce((sum, e) => sum + billableMinutes(e), 0);
  return (
    <section className="card" aria-label="Enthaltene Leistungen">
      <h2>Enthaltene Leistungen</h2>
      <p className="muted small" style={{ margin: 0 }}>
        Aus {entries.length === 1 ? "diesem Eintrag" : `diesen ${entries.length} Einträgen`} unter Leistungen ist die Rechnung entstanden;{" "}
        {formatDuration(total)} Std. sind berechnet.
      </p>
      <div className="table">
        <div className="table-row head proof-cols">
          <div>Tag</div>
          <div>Tätigkeit</div>
          <div className="num">Dauer</div>
        </div>
        {entries.map((e) => (
          <div key={e.id} className="table-row proof-cols">
            <div>{formatDate(e.workedOn)}</div>
            <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
              {e.description || <span className="muted">ohne Text</span>}
              {e.project && <div className="small muted">{e.project}</div>}
            </div>
            <div className="num">{formatDuration(billableMinutes(e))} Std.</div>
          </div>
        ))}
      </div>
    </section>
  );
}

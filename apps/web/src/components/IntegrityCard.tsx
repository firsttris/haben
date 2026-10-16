import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { formatDateTime } from "../lib/format.ts";
import { useAction } from "../lib/use-action.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { comparePruefwert, runIntegrityCheck, type getChainHead } from "../server/functions/integrity.ts";
import type { IntegrityReport } from "../server/integrity.ts";

type Head = Awaited<ReturnType<typeof getChainHead>>;

const TABELLEN: Record<string, string> = {
  audit_log: "Audit-Log",
  audit_chain: "Kopf der Kette",
  journal_entries: "Buchung",
  invoices: "Rechnung",
  documents: "Beleg",
  vat_returns: "Voranmeldung",
  cash_entries: "Kassenbuch",
  allocations: "Zuordnung",
  pauschalen: "Pauschale",
  asset_depreciations: "AfA",
};

/** Hash-Kette des Audit-Logs und Siegel festgeschriebener Datensätze prüfen (Einstellungen → Export) */
export function IntegrityCard({ head }: { head: Head }) {
  const check = useServerFn(runIntegrityCheck);
  const compare = useServerFn(comparePruefwert);
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const [text, setText] = useState("");
  const action = useAction();
  const { busy, notice } = action;
  const current = report?.head ?? head;

  function onCompare(event: FormEvent) {
    event.preventDefault();
    void action.run(async () => {
      const result = await compare({ data: { text } });
      if (result.status === "ok") {
        action.setNotice({
          tone: "ok",
          text: `Prüfwert Nr. ${result.seq} stimmt und die Kette ist bis dorthin lückenlos: Das Protokoll ist bis zu diesem Eintrag unverändert. Siegel und spätere Einträge prüft „Kette prüfen“.`,
        });
      } else if (result.status === "beschaedigt") {
        action.setNotice({
          tone: "danger",
          text: `Prüfwert Nr. ${result.seq} stimmt, aber Eintrag Nr. ${result.first} davor passt nicht mehr zur Kette (${result.befund}). Er wurde nachträglich verändert.`,
        });
      } else if (result.status === "abweichend") {
        action.setNotice({
          tone: "danger",
          text: `Prüfwert Nr. ${result.seq} stimmt nicht. Das Protokoll wurde bis zu diesem Eintrag verändert und neu verkettet. Erwartet ${result.expected}, gefunden ${result.actual}.`,
        });
      } else {
        action.setNotice({
          tone: "danger",
          text: `Eintrag Nr. ${result.seq} fehlt, das Protokoll endet bei Nr. ${result.head ?? "–"}. Entweder wurde ein älteres Backup eingespielt oder Einträge wurden gelöscht.`,
        });
      }
    });
  }

  return (
    <section className="card" aria-labelledby="integrity-heading">
      <h2 id="integrity-heading">Änderungsprotokoll prüfen</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Jede Änderung steht im Audit-Log, jeder Eintrag ist per SHA-256 mit seinem Vorgänger verkettet. Festgeschriebene Buchungen, Rechnungen,
        Belege, Voranmeldungen, Kassenbuch, Zuordnungen, Pauschalen und AfA tragen zusätzlich ein Siegel über ihren Inhalt. Die Prüfung findet nachträgliche Änderungen an der Datenbank,
        verhindert sie aber nicht. Wer die Datenbank ändern kann, kann auch die Kette neu berechnen; das zeigt erst ein Vergleich mit einem
        Prüfwert, den du außerhalb des Servers aufbewahrst (wöchentliche Mail, Jahresarchiv).
      </p>
      {current && (
        <div className="small">
          <div className="muted">Aktueller Prüfwert</div>
          <code style={{ overflowWrap: "anywhere" }}>Nr. {current.seq} · {current.hash}</code>
          {current.at && <div className="muted">Letzte Änderung {formatDateTime(current.at)}</div>}
        </div>
      )}
      <div className="actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() =>
            void action.run(async () => {
              const result = await check();
              setReport(result);
              action.setNotice(
                result.problems.length === 0
                  ? { tone: "ok", text: `Kette und Siegel sind unverändert: ${result.entries} Einträge, ${result.seals} Siegel geprüft.` }
                  : { tone: "danger", text: `${result.problems.length}${result.truncated ? " oder mehr" : ""} Befunde. Die Datenbank wurde außerhalb von Haben verändert.` },
              );
            })
          }
        >
          {busy ? "Prüft …" : "Kette prüfen"}
        </button>
      </div>
      {report && report.problems.length > 0 && (
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {report.problems.map((p, i) => (
            <li key={i} style={{ overflowWrap: "anywhere" }}>
              <strong>{TABELLEN[p.tabelle] ?? p.tabelle}</strong>
              {p.seq !== null && ` Nr. ${p.seq}`}
              {p.art === "siegel" && p.zeile && <span className="mono muted"> {p.zeile}</span>}: {p.befund}
            </li>
          ))}
        </ul>
      )}
      <form className="actions" style={{ alignItems: "flex-end", borderTop: "1px solid var(--line)", paddingTop: 16 }} onSubmit={onCompare}>
        <label className="field" style={{ flex: 1, minWidth: 0 }}>
          Prüfwert aus Mail oder Jahresarchiv
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Nr. 1234 · 3f5a…" autoComplete="off" spellCheck={false} required />
        </label>
        <button type="submit" className="btn" disabled={busy || !text.trim()}>
          Vergleichen
        </button>
      </form>
      <NoticeBanner notice={notice} />
    </section>
  );
}

import { formatEuro } from "@haben/core";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { formatDateTime } from "../lib/format.ts";
import { integrityNotice, pruefwertNotice, weitereText } from "../lib/pruefbericht.ts";
import { useAction } from "../lib/use-action.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { comparePruefwert, runFileAndIntegrityCheck, runIntegrityCheck, type getChainHead } from "../server/functions/integrity.ts";
import type { IntegrityReport } from "../server/modules/auswertungen/index.ts";
import { Field } from "./Field.tsx";

type Head = Awaited<ReturnType<typeof getChainHead>>;

const BEREICH: Record<IntegrityReport["abgleich"]["abweichungen"][number]["bereich"], string> = {
  ustva: "Voranmeldung",
  euer: "EÜR",
  opos: "Anzahlungsbestände",
  beleg: "Beleg",
  bank: "Bank",
};

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

/** Letzte Vollprüfung der Dateien im Dokumentenspeicher: Zeitpunkt, Anzahl und je Datei mit Befund Art und Name */
function FileCheckResult({ files }: { files: IntegrityReport["files"] }) {
  if (!files) return <p className="small muted">Belegdateien: noch nicht vollständig geprüft. Haben prüft sie einmal am Tag.</p>;
  return (
    <div className="small">
      <div className="muted">
        Belegdateien, zuletzt vollständig geprüft am {formatDateTime(files.at)}: {files.files} {files.files === 1 ? "Datei" : "Dateien"}
        {files.problemCount === 0 ? ", alle vorhanden und unverändert." : `, ${files.problemCount} ${files.problemCount === 1 ? "Befund" : "Befunde"}:`}
      </div>
      {files.problems.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {files.problems.map((p) => (
            <li key={`${p.tabelle}:${p.zeile}`} style={{ overflowWrap: "anywhere" }}>
              <strong>{p.art}</strong> {p.datei}: {p.befund}
              {weitereText(p.weitere)}
            </li>
          ))}
          {files.problemCount > files.problems.length && <li className="muted">und {files.problemCount - files.problems.length} weitere</li>}
        </ul>
      )}
    </div>
  );
}

/** Hash-Kette des Audit-Logs und Siegel festgeschriebener Datensätze prüfen (Einstellungen → Export) */
export function IntegrityCard({ head }: { head: Head }) {
  const check = useServerFn(runIntegrityCheck);
  const checkFiles = useServerFn(runFileAndIntegrityCheck);
  const compare = useServerFn(comparePruefwert);
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const [running, setRunning] = useState<"kette" | "dateien" | null>(null);
  const [text, setText] = useState("");
  const action = useAction();
  const { busy, notice } = action;
  const current = report?.head ?? head;

  function onCheck(kind: "kette" | "dateien") {
    setRunning(kind);
    void action
      .run(async () => {
        const result = await (kind === "dateien" ? checkFiles() : check());
        setReport(result);
        action.setNotice(integrityNotice(result));
      })
      .finally(() => setRunning(null));
  }

  function onCompare(event: FormEvent) {
    event.preventDefault();
    void action.run(async () => {
      action.setNotice(pruefwertNotice(await compare({ data: { text } })));
    });
  }

  return (
    <section className="card" aria-labelledby="integrity-heading">
      <h2 id="integrity-heading">Änderungsprotokoll prüfen</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Jede Änderung steht im Audit-Log, jeder Eintrag ist per SHA-256 mit seinem Vorgänger verkettet. Festgeschriebene Buchungen, Rechnungen, Belege,
        Voranmeldungen, Kassenbuch, Zuordnungen, Pauschalen und AfA tragen zusätzlich ein Siegel über ihren Inhalt. Außerdem gleicht die Prüfung das Journal mit
        Umsatzsteuer, EÜR und den neuen Anzahlungsbeständen ab und meldet Kontenkollisionen sowie abgeschaltete, fehlende oder veränderte Sperrtrigger und
        Funktionen. Belege, Anhänge und andere Dateien liegen außerhalb der Datenbank unter ihrem SHA-256; Haben prüft einmal am Tag, ob jede vorhanden und
        unverändert ist, „Dateien prüfen“ sofort. Die Prüfung findet nachträgliche Änderungen, verhindert sie aber nicht. Wer die Datenbank ändern kann, kann
        auch die Kette neu berechnen; das zeigt erst ein Vergleich mit einem Prüfwert, den du außerhalb des Servers aufbewahrst (wöchentliche Mail,
        Jahresarchiv).
      </p>
      {current && (
        <div className="small">
          <div className="muted">Aktueller Prüfwert</div>
          <code style={{ overflowWrap: "anywhere" }}>
            Nr. {current.seq} · {current.hash}
          </code>
          {current.at && <div className="muted">Letzte Änderung {formatDateTime(current.at)}</div>}
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn" disabled={busy} onClick={() => onCheck("dateien")}>
          {running === "dateien" ? "Prüft Dateien …" : "Dateien prüfen"}
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onCheck("kette")}>
          {running === "kette" ? "Prüft …" : "Kette prüfen"}
        </button>
      </div>
      {report && report.problems.length > 0 && (
        <ul className="small" style={{ margin: 0, paddingLeft: 20 }}>
          {report.problems.map((p, i) => (
            <li key={i} style={{ overflowWrap: "anywhere" }}>
              <strong>{TABELLEN[p.tabelle] ?? p.tabelle}</strong>
              {p.seq !== null && ` Nr. ${p.seq}`}
              {p.art === "siegel" && p.zeile && <span className="mono muted"> {p.zeile}</span>}: {p.befund}
            </li>
          ))}
        </ul>
      )}
      {report && report.triggerHints.length > 0 && (
        <div className="small">
          <div className="muted">Hinweise zu Sperrtriggern</div>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {report.triggerHints.map((hint) => (
              <li key={hint} className="muted" style={{ overflowWrap: "anywhere" }}>
                {hint}
              </li>
            ))}
          </ul>
        </div>
      )}
      {report && <FileCheckResult files={report.files} />}
      {report && (report.abgleich.abweichungen.length > 0 || report.abgleich.hinweise.length > 0) && (
        <div className="small">
          <div className="muted">Abgleich im Journal: Umsatzsteuer, gesendete Voranmeldungen, Rechnungen, Bank, EÜR und Anzahlungsbestände</div>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {report.abgleich.abweichungen.map((a, i) => (
              <li key={i}>
                <strong>
                  {BEREICH[a.bereich]} {a.zeitraum}
                </strong>
                , {a.posten}: Journal {formatEuro(a.journal)}, {a.gegen} {formatEuro(a.quelle)}
              </li>
            ))}
            {report.abgleich.hinweise.map((h) => (
              <li key={h} className="muted">
                {h}
              </li>
            ))}
          </ul>
        </div>
      )}
      {report && report.accountCollisions.length > 0 && (
        <section className="small" aria-labelledby="account-collisions-heading">
          <h3 id="account-collisions-heading">Kontenkollisionen</h3>
          <p>
            Diese eigenen Kontonummern werden inzwischen auch von Haben verwendet. Das kann Auswertungen verfälschen. Kläre die Zuordnung mit deiner
            Steuerberatung. Archivieren allein löst die Kollision nicht, weil die Zuordnung für bestehende Buchungen weiterwirkt.
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {report.accountCollisions.map((account) => (
              <li key={`${account.kontenrahmen}:${account.account}`} style={{ overflowWrap: "anywhere" }}>
                {account.kontenrahmen} · {account.account} · {account.name}
              </li>
            ))}
          </ul>
        </section>
      )}
      <form className="actions" style={{ alignItems: "flex-end", borderTop: "1px solid var(--line)", paddingTop: 16 }} onSubmit={onCompare}>
        <Field label="Prüfwert aus Mail oder Jahresarchiv" style={{ flex: 1, minWidth: 0 }}>
          {(control) => (
            <input
              {...control}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Nr. 1234 · 3f5a…"
              autoComplete="off"
              spellCheck={false}
              required
            />
          )}
        </Field>
        <button type="submit" className="btn" disabled={busy || !text.trim()}>
          Vergleichen
        </button>
      </form>
      <NoticeBanner notice={notice} />
    </section>
  );
}

import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatDateTime } from "../../lib/format.ts";
import { useAction } from "../../lib/use-action.ts";
import { NoticeBanner } from "../NoticeBanner.tsx";
import { FilePicker } from "../FilePicker.tsx";
import {
  cancelAccountableImport,
  getAccountableStatus,
  getImportStatus,
  startAccountableImport,
  startLexofficeImport,
  startSevdeskImport,
  uploadAccountableExport,
} from "../../server/functions/archive.ts";
import { startFastbillImport } from "../../server/functions/fastbill.ts";
import { ConfirmDialog } from "../ConfirmDialog.tsx";
import { Icon } from "../Icon.tsx";
import { SevdeskFileFacts } from "./Dateistand.tsx";
import { ImportWaitNotice } from "./FastbillTeile.tsx";
import { Field } from "../Field.tsx";

import { type ConnectedSource, type ImportRow, SOURCES } from "./migration-quellen.ts";

/* Abruf aus einer Quelle mit Fortschritt und Abbruch (Migration.tsx) */

const PHASES = { kontakte: "Kontakte", liste: "Belegliste", belege: "Belege und Dateien", fertig: "Fertig" } as const;

export function ImportCard({ source, connected, initial }: { source: ConnectedSource | "accountable"; connected: boolean; initial: ImportRow | null }) {
  const router = useRouter();
  const config = SOURCES[source];
  const startLexoffice = useServerFn(startLexofficeImport);
  const startSevdesk = useServerFn(startSevdeskImport);
  const startFastbill = useServerFn(startFastbillImport);
  const uploadAccountable = useServerFn(uploadAccountableExport);
  const startAccountable = useServerFn(startAccountableImport);
  const cancelAccountable = useServerFn(cancelAccountableImport);
  const pollStatus = useServerFn(getImportStatus);
  const pollAccountable = useServerFn(getAccountableStatus);
  const [run, setRun] = useState<ImportRow | null>(initial);
  const fileInput = useRef<HTMLInputElement>(null);
  const action = useAction();
  const running = run?.status === "laeuft";
  // Die Frage gehört zu genau diesem Lauf: Endet er, darf sie beim nächsten nicht von selbst wiederkommen
  const [cancellingRun, setCancellingRun] = useState<string | null>(null);

  /** Der laufende Abruf je Quelle; Accountable hat eine eigene Statusabfrage (jeder Upload ist ein eigener Lauf) */
  const poll = (id = run?.id) => (source === "accountable" ? pollAccountable({ data: id ? { id } : {} }) : pollStatus({ data: { source } }));

  useEffect(() => {
    if (!running) return;
    let stopped = false;
    const timer = setInterval(async () => {
      const next = await (source === "accountable" ? pollAccountable({ data: { id: run?.id } }) : pollStatus({ data: { source } })).catch(() => null);
      if (stopped || !next) return;
      setRun(next);
      if (next.status !== "laeuft") void router.invalidate();
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [running, pollAccountable, pollStatus, router, source, run?.id]);

  const onStart = () =>
    action.run(async () => {
      const started =
        source === "sevdesk"
          ? await startSevdesk()
          : source === "fastbill"
            ? await startFastbill()
            : source === "accountable"
              ? await startAccountable()
              : await startLexoffice();
      setRun(await poll(started.id));
    });

  /** Accountable hat keine API: Der Export wird hier hochgeladen, danach läuft der Abruf wie bei den anderen */
  const onUpload = (event: FormEvent) => {
    event.preventDefault();
    const chosen = [...(fileInput.current?.files ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    if (chosen.length === 0) return;
    void action.run(async () => {
      for (const [index, file] of chosen.entries()) {
        if (chosen.length > 1) action.setNotice({ tone: "info", text: `Datei ${index + 1} von ${chosen.length}: ${file.name}` });
        const form = new FormData();
        form.append("files", file);
        await uploadAccountable({ data: form });
        const { id } = await startAccountable();
        const next = await poll(id);
        setRun(next);
        if (next && next.status !== "laeuft") await router.invalidate();
      }
      if (fileInput.current) fileInput.current.value = "";
    });
  };

  const progress = run?.progress;
  const done = run?.status === "fertig" && (progress?.failed.length ?? 0) === 0;
  const accountable = source === "accountable";
  return (
    <section className={`card stack${done ? " step-done" : ""}`} aria-labelledby="import-heading">
      <div className="step-head">
        <span className="step-num">{done ? <Icon name="check" /> : "2"}</span>
        <h2 id="import-heading" style={{ margin: 0 }}>
          {accountable ? "Accountable-Export übernehmen" : "Kontakte, Rechnungen und Belege abrufen"}
        </h2>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {config.importHelp}
      </p>
      {accountable && !running && (
        <form className="stack" onSubmit={onUpload} style={{ gap: 12 }}>
          <Field label="Exportdatei (ZIP)">{(control) => <FilePicker {...control} inputRef={fileInput} multiple accept=".zip,application/zip" />}</Field>
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={action.busy}>
              {action.busy ? "Übernehme …" : "Hochladen und übernehmen"}
            </button>
          </div>
        </form>
      )}
      {progress && run && <ImportProgress run={run} progress={progress} source={source} running={running} />}
      <NoticeBanner notice={action.notice} />
      <ConfirmDialog
        open={running && cancellingRun === run?.id}
        title="Abruf abbrechen?"
        confirmLabel="Abruf abbrechen"
        danger
        onConfirm={() => run && void action.run(() => (source === "accountable" ? cancelAccountable : SOURCES[source].cancel)({ data: { id: run.id } }))}
        onClose={() => setCancellingRun(null)}
      >
        <p>
          {accountable
            ? "Du kannst den Export jederzeit neu hochladen. Schon Übernommenes bleibt und wird übersprungen."
            : "Du kannst den Abruf jederzeit neu starten. Schon Übernommenes bleibt und wird übersprungen; Kontakte und Belegliste liest Haben dabei noch einmal."}
        </p>
      </ConfirmDialog>
      {running ? (
        <div className="actions">
          <button type="button" className="btn" disabled={action.busy} onClick={() => setCancellingRun(run?.id ?? null)}>
            Abbrechen
          </button>
        </div>
      ) : (
        !accountable && (
          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={onStart} disabled={!connected || action.busy}>
              {run ? "Erneut abrufen" : "Alles abrufen"}
            </button>
          </div>
        )
      )}
    </section>
  );
}

/** Stand des Abrufs: Phase, Zahlen, Hinweise je Quelle und offene Punkte */
function ImportProgress({
  run,
  progress,
  source,
  running,
}: {
  run: ImportRow;
  progress: NonNullable<ImportRow["progress"]>;
  source: ConnectedSource | "accountable";
  running: boolean;
}) {
  const accountable = source === "accountable";
  // Was die Belegliste übergeht (#1504): Entwürfe, die keine Belege sind
  const ignored = progress.ignored;
  const ignoredText = ignored && ignored.drafts > 0 ? `${ignored.drafts} ${ignored.drafts === 1 ? "Entwurf" : "Entwürfe"}` : "";
  return (
    <div className="stack" style={{ gap: 12 }} aria-live="polite">
      <div className="small">
        {run.status === "laeuft" ? `Läuft: ${PHASES[progress.phase]}` : null}
        {run.status === "fertig" ? `Fertig am ${formatDateTime(run.finishedAt ?? run.updatedAt)}` : null}
        {run.status === "fehler" ? "Abgebrochen mit Fehler" : null}
        {run.status === "abgebrochen" ? "Abgebrochen" : null}
      </div>
      <div className="progress-facts">
        {!accountable && (
          <>
            <div>
              <span className="small muted">Kontakte neu</span>
              <strong>{progress.contacts}</strong>
            </div>
            <div>
              <span className="small muted">verknüpft</span>
              <strong>{progress.contactsLinked}</strong>
            </div>
          </>
        )}
        <div>
          <span className="small muted">{source === "sevdesk" ? "Dokumente gefunden" : "Belege gefunden"}</span>
          <strong>{progress.listed}</strong>
        </div>
        <div>
          <span className="small muted">übernommen</span>
          <strong>
            {progress.imported + progress.skipped}
            {progress.listed ? ` / ${progress.listed}` : ""}
          </strong>
        </div>
        <div>
          <span className="small muted">Dateien</span>
          <strong>{progress.files}</strong>
        </div>
        {source === "sevdesk" && progress.sevdeskFiles && <SevdeskFileFacts files={progress.sevdeskFiles} />}
        {(progress.recurring ?? 0) > 0 && (
          <div>
            <span className="small muted">Dauerbelege angehalten</span>
            <strong>{progress.recurring}</strong>
          </div>
        )}
        {/* Schon übernommene Belege, deren fehlende Datei eine spätere Sicherung mitbrachte (#1504, #1624) */}
        {(progress.nachgeladen ?? 0) > 0 && (
          <div>
            <span className="small muted">Belege nachgeladen</span>
            <strong>{progress.nachgeladen}</strong>
          </div>
        )}
      </div>
      {running && <ImportWaitNotice waitingUntil={progress.waitingUntil} fastbill={source === "fastbill"} updatedAt={run.updatedAt} />}
      {source === "sevdesk" && (
        <div className="banner">
          <p style={{ margin: 0 }}>
            <strong>Kontaktrollen prüfen:</strong> Neue Partner, Interessenten und Kontakte ohne eindeutige sevDesk-Kategorie werden zunächst als Kunden
            angelegt. Bestehende Kontakte erhalten nur zusätzliche eindeutige Rollen; ein früher fälschlich als Kunde importierter Lieferant bleibt deshalb auch
            Kunde. Entferne diese Rolle bei Bedarf unter Kontakte. Vorhandene Nummern bleiben unverändert.
          </p>
        </div>
      )}
      {source === "sevdesk" && progress.sevdeskRecurring && progress.sevdeskRecurring.imported + progress.sevdeskRecurring.known > 0 && (
        <p className="small" style={{ margin: 0 }}>
          {progress.sevdeskRecurring.imported + progress.sevdeskRecurring.known} Vorlagen für{" "}
          <Link to="/rechnungen/wiederkehrend">wiederkehrende Rechnungen</Link> pausiert übernommen; prüfe und aktiviere sie dort.
          {progress.sevdeskRecurring.placeholders.length > 0 && (
            <>
              {" "}
              Platzhalter von sevDesk stehen als Text darin: <span className="mono">{progress.sevdeskRecurring.placeholders.join(" ")}</span>
            </>
          )}
        </p>
      )}
      {source === "sevdesk" && (progress.vatReports ?? 0) > 0 && (
        <p className="small" style={{ margin: 0 }}>
          {progress.vatReports} übermittelte Voranmeldungen archiviert, zu finden unter{" "}
          <Link to="/archiv" search={{ ansicht: "voranmeldungen" }}>
            Voranmeldungen
          </Link>
          .
        </p>
      )}
      {run.error && (
        <div className="banner banner-danger" role="alert">
          {run.error}
        </div>
      )}
      {ignoredText && (
        <p className="small muted" style={{ margin: 0 }}>
          Übergangen, kein Beleg: {ignoredText}
        </p>
      )}
      {progress.failed.length > 0 && (
        <details>
          <summary className="small">{progress.failed.length} offene Punkte beim Abruf</summary>
          <ul className="small" style={{ margin: "8px 0 0", paddingLeft: 20 }}>
            {progress.failed.slice(0, 50).map((f) => (
              <li key={f.lexofficeId}>
                {f.number || f.lexofficeId}: {f.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

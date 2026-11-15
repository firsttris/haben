import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type FormEvent } from "react";
import { formatDateTime } from "../../lib/format.ts";
import { useAction } from "../../lib/use-action.ts";
import type { getMigration } from "../../server/functions/archive.ts";
import { cancelSevdeskExportImport, getSevdeskExportStatus, startSevdeskExportImport, uploadSevdeskExport } from "../../server/functions/sevdesk-export.ts";
import { ConfirmDialog } from "../ConfirmDialog.tsx";
import { Field } from "../Field.tsx";
import { FilePicker } from "../FilePicker.tsx";
import { NoticeBanner } from "../NoticeBanner.tsx";

type MigrationData = Awaited<ReturnType<typeof getMigration>>;
type Run = NonNullable<MigrationData["sevdeskExportImport"]>;
type Analysis = Awaited<ReturnType<typeof uploadSevdeskExport>>;

const STACK_STATE = { neu: "wird übernommen", vorhanden: "liegt schon im Archiv", zeitraum: "Zeitraum schon belegt" } as const;

/** sevDesk ohne API (#1105): Export-ZIP hochladen, Vorschau prüfen, übernehmen */
export function SevdeskExportImport({ initial }: { initial: Run | null }) {
  const router = useRouter();
  const upload = useServerFn(uploadSevdeskExport);
  const start = useServerFn(startSevdeskExportImport);
  const cancel = useServerFn(cancelSevdeskExportImport);
  const poll = useServerFn(getSevdeskExportStatus);
  const check = useAction();
  const action = useAction();
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [run, setRun] = useState<Run | null>(initial);
  const [confirming, setConfirming] = useState(false);
  const running = run?.status === "laeuft";

  useEffect(() => {
    if (!running) return;
    let stopped = false;
    const timer = setInterval(async () => {
      const next = await poll({ data: { id: run?.id } }).catch(() => null);
      if (stopped || !next) return;
      setRun(next);
      if (next.status !== "laeuft") void router.invalidate();
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [running, poll, router, run?.id]);

  function onCheck(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    const data = new FormData();
    data.append("files", file);
    void check.run(async () => setAnalysis(await upload({ data })));
  }

  const onStart = () =>
    action.run(async () => {
      setConfirming(false);
      const { id } = await start();
      const next = await poll({ data: { id } });
      setAnalysis(null);
      setRun(next);
      if (next && next.status !== "laeuft") await router.invalidate();
    });

  return (
    <section className="card stack" aria-labelledby="sevdesk-export-heading">
      <h2 id="sevdesk-export-heading" style={{ margin: 0 }}>
        Ohne API: Export hochladen
      </h2>
      <p className="small muted" style={{ margin: 0 }}>
        Ohne API-Token übernimmt Haben den Export <strong>Buchungsdaten & Belegbilder</strong> aus sevDesk (Steuern → Mein Steuerberater), je Geschäftsjahr eine
        ZIP-Datei. Daraus werden Belege mit ihren Belegbildern im Archiv, dazu der Buchungsstapel. Positionen, Zahlungen und offene Posten enthält der Export
        nicht.
      </p>
      {!running && (
        <form className="stack" onSubmit={onCheck} style={{ gap: 12 }}>
          <Field label="Export-ZIP" hint="Die Prüfung legt noch nichts an.">
            {(control) => (
              <FilePicker
                {...control}
                accept=".zip,application/zip"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setAnalysis(null);
                }}
              />
            )}
          </Field>
          <div className="actions">
            <button type="submit" className="btn" disabled={!file || check.busy || action.busy}>
              {check.busy ? "Prüfe …" : "Hochladen und prüfen"}
            </button>
          </div>
        </form>
      )}
      <NoticeBanner notice={check.notice} />
      {analysis && !running && (
        <>
          <Facts analysis={analysis} />
          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={() => setConfirming(true)} disabled={action.busy}>
              Übernehmen
            </button>
          </div>
        </>
      )}
      {run && <RunState run={run} onCancel={() => void action.run(() => cancel({ data: { id: run.id } }))} busy={action.busy} />}
      <NoticeBanner notice={action.notice} />
      <ConfirmDialog
        open={confirming}
        title="Export unveränderlich übernehmen?"
        confirmLabel="Übernehmen"
        facts={
          analysis
            ? [
                { label: "Jahr", value: analysis.years.join(", ") || "–" },
                { label: "Belege", value: String(analysis.vouchers - analysis.inApiYears) },
                { label: "Belegbilder", value: String(analysis.withFile) },
              ]
            : []
        }
        onConfirm={() => void onStart()}
        onClose={() => setConfirming(false)}
      >
        <p>ZIP-Datei, Buchungsstapel, Belege und Belegbilder liegen danach unveränderlich im Archiv. Was schon da ist, überspringt Haben.</p>
      </ConfirmDialog>
    </section>
  );
}

function Facts({ analysis }: { analysis: Analysis }) {
  const facts: [string, number | string][] = [
    ["Jahr", analysis.years.join(", ") || "–"],
    ["Buchungen", analysis.bookings],
    ["Belege", analysis.vouchers],
    ["mit Belegbild", analysis.withFile],
    ["ohne Belegbild", analysis.withoutImage + analysis.missingFile],
  ];
  return (
    <div className="stack" style={{ gap: 12 }} aria-live="polite">
      <div className="progress-facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <span className="small muted">{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <ul className="small" style={{ margin: 0, paddingLeft: 20 }}>
        <li>ZIP-Datei: {analysis.zipArchived ? "liegt schon im Archiv" : "wird abgelegt"}</li>
        {analysis.stacks.map((s) => (
          <li key={s.name}>
            {s.name}: {STACK_STATE[s.state]}
            {s.other ? ` (${s.other})` : ""}
          </li>
        ))}
        {analysis.inApiYears > 0 && (
          <li>
            {analysis.inApiYears} Belege in {analysis.apiYears.join(", ")} nicht übernommen: Für diese Jahre gibt es Belege aus der API.
          </li>
        )}
        {analysis.otherAccounts > 0 && (
          <li>{analysis.otherAccounts} Belege auf Konten wie Darlehen, Privat, Steuern oder Zinsen; sie zählen nicht als Einnahme oder Ausgabe.</li>
        )}
      </ul>
      {analysis.hintCount > 0 && (
        <details>
          <summary className="small">{analysis.hintCount} Hinweise aus dem Export</summary>
          <ul className="small" style={{ margin: "8px 0 0", paddingLeft: 20 }}>
            {analysis.hints.map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function RunState({ run, onCancel, busy }: { run: Run; onCancel: () => void; busy: boolean }) {
  const p = run.progress;
  return (
    <div className="stack" style={{ gap: 12 }} aria-live="polite">
      <div className="small">
        {run.status === "laeuft" ? `Läuft: ${p.imported + p.skipped} von ${p.listed} Belegen` : null}
        {run.status === "fertig"
          ? `Übernommen am ${formatDateTime(run.finishedAt ?? run.updatedAt)}: ${p.imported} neu, ${p.skipped} übersprungen, ${p.files} Belegbilder`
          : null}
        {run.status === "fehler" ? "Abgebrochen mit Fehler" : null}
        {run.status === "abgebrochen" ? "Abgebrochen" : null}
      </div>
      {run.sevdeskExport?.note && (
        <p className="small muted" style={{ margin: 0 }}>
          {run.sevdeskExport.note}
        </p>
      )}
      {run.error && (
        <div className="banner banner-danger" role="alert">
          {run.error}
        </div>
      )}
      {p.failed.length > 0 && (
        <details>
          <summary className="small">{p.failed.length} Belege nicht übernommen</summary>
          <ul className="small" style={{ margin: "8px 0 0", paddingLeft: 20 }}>
            {p.failed.slice(0, 50).map((f) => (
              <li key={f.lexofficeId}>
                {f.number || f.lexofficeId}: {f.message}
              </li>
            ))}
          </ul>
        </details>
      )}
      {run.status === "laeuft" && (
        <div className="actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Abbrechen
          </button>
        </div>
      )}
    </div>
  );
}

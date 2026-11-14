import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { formatDateTime } from "../../lib/format.ts";
import { useAction } from "../../lib/use-action.ts";
import { importWiso, previewWisoImport, type getMigration } from "../../server/functions/archive.ts";
import { ConfirmDialog } from "../ConfirmDialog.tsx";
import { Field } from "../Field.tsx";
import { Icon } from "../Icon.tsx";
import { NoticeBanner } from "../NoticeBanner.tsx";

type MigrationData = Awaited<ReturnType<typeof getMigration>>;
type ImportRow = NonNullable<MigrationData["wisoImport"]>;
type Preview = Awaited<ReturnType<typeof previewWisoImport>>;
type Result = Awaited<ReturnType<typeof importWiso>>;

export function WisoImport({ initial }: { initial: ImportRow | null }) {
  const router = useRouter();
  const previewFn = useServerFn(previewWisoImport);
  const importFn = useServerFn(importWiso);
  const previewAction = useAction();
  const importAction = useAction();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [confirming, setConfirming] = useState(false);

  const formData = () => {
    const data = new FormData();
    if (file) data.append("file", file);
    return data;
  };
  const onPreview = (event: FormEvent) => {
    event.preventDefault();
    void previewAction.run(async () => setPreview(await previewFn({ data: formData() })));
  };
  const onImport = () =>
    importAction.run(async () => {
      setResult(await importFn({ data: formData() }));
      setConfirming(false);
      setPreview(null);
      await router.invalidate();
    });

  const done = result || (initial?.status === "fertig" ? initial : null);
  return (
    <section className={`card stack${done ? " step-done" : ""}`} aria-labelledby="wiso-import-heading">
      <div className="step-head">
        <span className="step-num">{done ? <Icon name="check" /> : "1"}</span>
        <h2 id="wiso-import-heading" style={{ margin: 0 }}>
          WISO-Buchungen als CSV prüfen und importieren
        </h2>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Wähle den CSV-Export der Buchungen aus WISO Steuer (Modul EÜR) oder WISO EÜR &amp; Kasse (<code>Daten Export › Buchungen als CSV-Datei</code>). Beide
        Programme nutzen dieselben 18 Spalten. Kontenrahmen, Rechtsform und Versteuerungsart liest Haben aus den Firmendaten.
      </p>
      <form className="stack" onSubmit={onPreview}>
        <Field label="WISO-Buchungs-CSV" hint="Der Testlauf schreibt noch nichts in die Datenbank.">
          {(control) => (
            <input
              {...control}
              type="file"
              accept=".csv"
              required
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setPreview(null);
                setResult(null);
              }}
            />
          )}
        </Field>
        <div className="actions">
          <button type="submit" className="btn" disabled={!file || previewAction.busy || importAction.busy}>
            {previewAction.busy ? "Prüfe CSV …" : "Testlauf starten"}
          </button>
        </div>
      </form>
      <NoticeBanner notice={previewAction.notice} />
      {preview && <WisoPreviewFacts preview={preview} busy={importAction.busy} onStart={() => setConfirming(true)} />}
      <NoticeBanner notice={importAction.notice} />
      {result && (
        <div className="banner banner-ok" role="status">
          Import abgeschlossen: {result.imported} Buchungen übernommen{result.skipped > 0 ? `, ${result.skipped} bereits vorhanden` : ""}.
        </div>
      )}
      {!result && initial && (
        <p className="small muted" style={{ margin: 0 }}>
          Letzter Lauf ({formatDateTime(initial.startedAt)}): {initial.progress.imported} übernommen, {initial.progress.skipped} übersprungen ({initial.status}
          ).
        </p>
      )}
      <WisoConfirmDialog preview={preview} open={confirming} onConfirm={() => void onImport()} onClose={() => setConfirming(false)} />
    </section>
  );
}

function WisoPreviewFacts({ preview, busy, onStart }: { preview: Preview; busy: boolean; onStart: () => void }) {
  return (
    <div className="stack">
      <div className="facts">
        <div>
          <span className="muted">Jahre</span>
          <strong>{preview.years.join(", ")}</strong>
        </div>
        <div>
          <span className="muted">Zeitraum</span>
          <strong>
            {preview.dateFrom} bis {preview.dateTo}
          </strong>
        </div>
        <div>
          <span className="muted">Buchungen</span>
          <strong>{preview.bookings}</strong>
        </div>
        <div>
          <span className="muted">Zeilen</span>
          <strong>{preview.rows}</strong>
        </div>
      </div>
      {preview.warnings.length > 0 && (
        <ul className="upload-messages">
          {preview.warnings.map((warning) => (
            <li key={warning} className="banner banner-warn">
              {warning}
            </li>
          ))}
        </ul>
      )}
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={onStart} disabled={busy}>
          {busy ? "Importiere …" : "Diese Daten importieren"}
        </button>
      </div>
    </div>
  );
}

function WisoConfirmDialog({ preview, open, onConfirm, onClose }: { preview: Preview | null; open: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <ConfirmDialog
      open={open}
      title="WISO-Buchungen unveränderlich importieren?"
      confirmLabel="Import starten"
      danger
      facts={
        preview
          ? [
              { label: "Jahre", value: preview.years.join(", ") },
              { label: "Buchungen", value: String(preview.bookings) },
              { label: "Zeilen", value: String(preview.rows) },
            ]
          : []
      }
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <p>Die Original-CSV und alle erkannten Buchungen werden unveränderlich archiviert. Bereits vorhandene Einträge werden übersprungen.</p>
    </ConfirmDialog>
  );
}

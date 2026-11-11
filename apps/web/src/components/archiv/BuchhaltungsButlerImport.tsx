import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { formatDateTime } from "../../lib/format.ts";
import { useAction } from "../../lib/use-action.ts";
import { importBuchhaltungsbutler, previewBuchhaltungsbutlerImport, type getMigration } from "../../server/functions/archive.ts";
import { ConfirmDialog } from "../ConfirmDialog.tsx";
import { Field } from "../Field.tsx";
import { Icon } from "../Icon.tsx";
import { NoticeBanner } from "../NoticeBanner.tsx";

type MigrationData = Awaited<ReturnType<typeof getMigration>>;
type ImportRow = NonNullable<MigrationData["bbImport"]>;
type Preview = Awaited<ReturnType<typeof previewBuchhaltungsbutlerImport>>;

export function BuchhaltungsButlerImport({ initial }: { initial: ImportRow | null }) {
  const router = useRouter();
  const previewFn = useServerFn(previewBuchhaltungsbutlerImport);
  const importFn = useServerFn(importBuchhaltungsbutler);
  const previewAction = useAction();
  const importAction = useAction();
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Preview | null>(null);
  const [confirming, setConfirming] = useState(false);

  function formData() {
    const data = new FormData();
    for (const file of files) data.append("files", file);
    return data;
  }

  function onPreview(event: FormEvent) {
    event.preventDefault();
    void previewAction.run(async () => setPreview(await previewFn({ data: formData() })));
  }

  const onImport = () =>
    importAction.run(async () => {
      setResult(await importFn({ data: formData() }));
      setConfirming(false);
      setPreview(null);
      await router.invalidate();
    });

  const done = result || (initial?.status === "fertig" ? initial : null);
  return (
    <section className={`card stack${done ? " step-done" : ""}`} aria-labelledby="bb-import-heading">
      <div className="step-head">
        <span className="step-num">{done ? <Icon name="check" /> : "1"}</span>
        <h2 id="bb-import-heading" style={{ margin: 0 }}>
          BuchhaltungsButler-Exporte prüfen und importieren
        </h2>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Wähle <code>datenexport.zip</code> und <code>EXTF_Buchungsstapel.csv</code> aus. Alternativ kannst du BB_Buchungsstapel.csv, Belege.zip und den
        EXTF-Buchungsstapel getrennt auswählen. Kontenrahmen, Rechtsform und Versteuerungsart liest Haben aus den Firmendaten.
      </p>
      <form className="stack" onSubmit={onPreview}>
        <Field label="BuchhaltungsButler-Exporte" hint="Der Testlauf schreibt noch nichts in die Datenbank.">
          {(control) => (
            <input
              {...control}
              type="file"
              multiple
              accept=".zip,.csv"
              required
              onChange={(event) => {
                setFiles(Array.from(event.target.files ?? []));
                setPreview(null);
                setResult(null);
              }}
            />
          )}
        </Field>
        <div className="actions">
          <button type="submit" className="btn" disabled={files.length === 0 || previewAction.busy || importAction.busy}>
            {previewAction.busy ? "Prüfe Export …" : "Testlauf starten"}
          </button>
        </div>
      </form>
      <NoticeBanner notice={previewAction.notice} />
      {preview && <PreviewFacts preview={preview} />}
      {preview && (
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={() => setConfirming(true)} disabled={importAction.busy}>
            {importAction.busy ? "Importiere …" : "Diese Daten importieren"}
          </button>
        </div>
      )}
      <NoticeBanner notice={importAction.notice} />
      {result && (
        <div className="banner banner-ok" role="status">
          Import abgeschlossen: {result.vouchers} Belege und {result.files} PDFs aus {result.bookings} Buchungen übernommen.
        </div>
      )}
      {!result && initial && <LastImport run={initial} />}
      <ConfirmDialog
        open={confirming}
        title="BuchhaltungsButler-Daten unveränderlich importieren?"
        confirmLabel="Import starten"
        danger
        facts={
          preview
            ? [
                { label: "Geschäftsjahr", value: String(preview.year) },
                { label: "Belege", value: String(preview.vouchers) },
                { label: "PDFs", value: String(preview.files) },
                { label: "Buchungen", value: String(preview.bookings) },
              ]
            : []
        }
        onConfirm={() => void onImport()}
        onClose={() => setConfirming(false)}
      >
        <p>Die Originalexporte, Belege und PDFs werden unveränderlich archiviert. Bereits vorhandene Dateien und Belege werden übersprungen.</p>
      </ConfirmDialog>
    </section>
  );
}

function PreviewFacts({ preview }: { preview: Preview }) {
  return (
    <div className="stack" aria-live="polite">
      <div className="progress-facts">
        <div>
          <span className="small muted">Geschäftsjahr</span>
          <strong>{preview.year}</strong>
        </div>
        <div>
          <span className="small muted">Buchungen</span>
          <strong>{preview.bookings}</strong>
        </div>
        <div>
          <span className="small muted">Belege</span>
          <strong>{preview.vouchers}</strong>
        </div>
        <div>
          <span className="small muted">PDFs</span>
          <strong>{preview.files}</strong>
        </div>
        <div>
          <span className="small muted">Ohne Beleg</span>
          <strong>{preview.withoutReceipt}</strong>
        </div>
      </div>
      <div className="banner banner-ok" role="status">
        Testlauf ohne Fehler: Alle Buchungsnummern, Beträge, Konten und PDF-Zuordnungen stimmen überein.
      </div>
      {preview.warnings.map((warning) => (
        <div className="banner banner-info" role="status" key={warning}>
          {warning}
        </div>
      ))}
    </div>
  );
}

function LastImport({ run }: { run: ImportRow }) {
  return (
    <div className="small muted">
      Letzter Import: {run.status} · {run.progress.imported} übernommen, {run.progress.skipped} übersprungen, {run.progress.files} Dateien ·{" "}
      {formatDateTime(run.finishedAt ?? run.updatedAt)}
      {run.error && <div className="banner banner-danger">{run.error}</div>}
    </div>
  );
}

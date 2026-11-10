import { currentYear } from "@haben/core";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState, type FormEvent } from "react";
import { z } from "zod/mini";
import { FilePicker } from "../../components/FilePicker.tsx";
import { NoticeBanner } from "../../components/NoticeBanner.tsx";
import { ScrollTable } from "../../components/ScrollTable.tsx";
import { useAction } from "../../lib/use-action.ts";
import { previewCsvImportFn, runCsvImportFn } from "../../server/functions/csv-import.ts";
import styles from "../../styles/auswertungen.css?url";
import { Field } from "../../components/Field.tsx";

type Kind = "kontakte" | "artikel" | "anlagen";
type Preview = Awaited<ReturnType<typeof previewCsvImportFn>>;
type Settings = { encoding: "auto" | "utf-8" | "windows-1252"; delimiter: "auto" | ";" | "," | "\t"; stichtag: string };

export const Route = createFileRoute("/_app/csv-import")({
  validateSearch: z.object({ art: z.optional(z.enum(["kontakte", "artikel", "anlagen"])) }),
  head: () => ({ meta: [{ title: "CSV-Import · Haben" }], links: [{ rel: "stylesheet", href: styles }] }),
  component: CsvImportPage,
});

const KINDS: { kind: Kind; label: string; list: "/kontakte" | "/artikel" | "/anlagen"; back: string; singular: string; plural: string }[] = [
  { kind: "kontakte", label: "Kontakte", list: "/kontakte", back: "Zu den Kontakten", singular: "Kontakt", plural: "Kontakte" },
  { kind: "artikel", label: "Artikel", list: "/artikel", back: "Zum Artikelkatalog", singular: "Artikel", plural: "Artikel" },
  { kind: "anlagen", label: "Anlagen", list: "/anlagen", back: "Zum Anlagenverzeichnis", singular: "Anlage", plural: "Anlagen" },
];

const INTRO: Record<Kind, string> = {
  kontakte:
    "Kunden und Lieferanten aus einer Liste übernehmen, etwa aus dem Kontakt-Export von Lexware Office oder aus Excel. Ohne Kundennummer vergibt Haben die nächste, wenn in den Einstellungen ein Format steht.",
  artikel: "Artikel und Leistungen mit Preis, Einheit und Steuersatz übernehmen, etwa aus „Produkte und Services“ von Lexware Office.",
  anlagen:
    "Anlagen aus der bisherigen Buchhaltung mit dem Restbuchwert zum Stichtag übernehmen, wie unter „Anlage übernehmen“. Der Import bucht nichts; die Eröffnung bucht Haben mit der ersten AfA.",
};

const STATUS: Record<Preview["rows"][number]["status"], { label: string; pill: string }> = {
  neu: { label: "neu", pill: "pill pill-ok" },
  dublette: { label: "Dublette", pill: "pill pill-info" },
  fehler: { label: "Fehler", pill: "pill pill-danger" },
};

/** So viele Zeilen zeigt die Vorschau; Fehler und Dubletten stehen vorn, damit keiner im Rest untergeht */
const SHOWN_ROWS = 200;

function CsvImportPage() {
  const { art } = Route.useSearch();
  const kind: Kind = art ?? "kontakte";
  const meta = KINDS.find((k) => k.kind === kind)!;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to={meta.list}>{meta.label}</Link> › Import
          </div>
          <h1>CSV-Import</h1>
        </div>
      </div>
      <nav className="chip-row" aria-label="Was importieren">
        {KINDS.map((k) => (
          <Link
            key={k.kind}
            to="/csv-import"
            search={{ art: k.kind }}
            className={k.kind === kind ? "chip active" : "chip"}
            aria-current={k.kind === kind ? "page" : undefined}
          >
            {k.label}
          </Link>
        ))}
      </nav>
      <p className="muted small" style={{ margin: 0, maxWidth: 760 }}>
        {INTRO[kind]}
      </p>
      {/* Neu aufbauen beim Wechsel der Art: Zuordnung und Vorschau gehören zur Art */}
      <CsvImport key={kind} kind={kind} />
    </>
  );
}

function CsvImport({ kind }: { kind: Kind }) {
  const meta = KINDS.find((k) => k.kind === kind)!;
  const previewFn = useServerFn(previewCsvImportFn);
  const importFn = useServerFn(runCsvImportFn);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [settings, setSettings] = useState<Settings>({ encoding: "auto", delimiter: "auto", stichtag: `${currentYear()}-01-01` });
  const [preview, setPreview] = useState<Preview | null>(null);
  const { busy, notice, setNotice, run } = useAction();
  // Die Vorschau gilt nur für die Einstellungen, mit denen sie gerechnet ist; der Import schickt die aktuellen
  const changeSettings = (patch: Partial<Settings>) => {
    setSettings({ ...settings, ...patch });
    setPreview(null);
  };

  const send = (fn: typeof previewFn | typeof importFn, chosen: File, mapping: Record<string, number | null> | null) => {
    const form = new FormData();
    form.set("file", chosen);
    const options = { kind, encoding: settings.encoding, delimiter: settings.delimiter, mapping, stichtag: kind === "anlagen" ? settings.stichtag : null };
    form.set("options", JSON.stringify(options));
    return fn({ data: form });
  };

  const showPreview = (chosen: File, mapping: Record<string, number | null> | null) =>
    void run(async () => {
      setPreview((await send(previewFn, chosen, mapping)) as Preview);
    });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const chosen = fileRef.current?.files?.[0] ?? null;
    if (!chosen) {
      setNotice({ tone: "danger", text: "Wähle zuerst eine CSV-Datei." });
      return;
    }
    setFile(chosen);
    showPreview(chosen, null);
  };

  const onImport = () => {
    if (!file || !preview) return;
    void run(async () => {
      const result = (await send(importFn, file, preview.mapping)) as { created: number; duplicates: number; failed: number };
      setPreview(null);
      const skipped = [
        result.duplicates > 0 && `${result.duplicates} ${result.duplicates === 1 ? "Dublette" : "Dubletten"}`,
        result.failed > 0 && `${result.failed} fehlerhafte ${result.failed === 1 ? "Zeile" : "Zeilen"}`,
      ]
        .filter(Boolean)
        .join(" und ");
      setNotice({
        tone: "ok",
        text: `${result.created} ${result.created === 1 ? meta.singular : meta.plural} übernommen${skipped ? `, ${skipped} übersprungen` : ""}.`,
      });
    });
  };

  return (
    <div className="stack">
      <form className="card stack" onSubmit={onSubmit} aria-labelledby="csv-file-heading">
        <h2 id="csv-file-heading">Datei</h2>
        <div className="form-grid">
          <Field label="CSV-Datei" hint="Bis 5 MB und 5.000 Zeilen, erste Zeile mit den Spaltennamen." style={{ gridColumn: "1 / -1" }}>
            {(control) => <FilePicker {...control} inputRef={fileRef} name="file" accept=".csv,.txt,text/csv" required />}
          </Field>
          <Field label="Trennzeichen">
            {(control) => (
              <select {...control} value={settings.delimiter} onChange={(e) => changeSettings({ delimiter: e.target.value as Settings["delimiter"] })}>
                <option value="auto">Automatisch erkennen</option>
                <option value=";">Semikolon</option>
                <option value=",">Komma</option>
                <option value={"\t"}>Tabulator</option>
              </select>
            )}
          </Field>
          <Field label="Kodierung">
            {(control) => (
              <select {...control} value={settings.encoding} onChange={(e) => changeSettings({ encoding: e.target.value as Settings["encoding"] })}>
                <option value="auto">Automatisch erkennen</option>
                <option value="utf-8">UTF-8</option>
                <option value="windows-1252">Windows-1252 (Excel unter Windows)</option>
              </select>
            )}
          </Field>
          {kind === "anlagen" && (
            <Field label="Übernahmestichtag" hint="In der Regel der 01.01. des ersten Jahres in Haben; Restbuchwert zum Vortag.">
              {(control) => (
                <input {...control} type="date" value={settings.stichtag} required onChange={(e) => changeSettings({ stichtag: e.target.value })} />
              )}
            </Field>
          )}
        </div>
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Vorschau
          </button>
        </div>
      </form>
      <NoticeBanner notice={notice} />
      {preview && file && (
        <>
          <MappingCard preview={preview} busy={busy} onChange={(mapping) => showPreview(file, mapping)} />
          <PreviewCard preview={preview} busy={busy} meta={meta} onImport={onImport} />
        </>
      )}
    </div>
  );
}

function MappingCard({ preview, busy, onChange }: { preview: Preview; busy: boolean; onChange: (mapping: Record<string, number | null>) => void }) {
  return (
    <section className="card stack" aria-labelledby="csv-mapping-heading">
      <h2 id="csv-mapping-heading">Spalten zuordnen</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Erkannt: {preview.encoding}, {preview.delimiter}, {preview.header.length} Spalten. Haben schlägt die Zuordnung nach den Spaltennamen vor; ändere sie
        hier, die Vorschau rechnet neu.
      </p>
      <div className="form-grid">
        {preview.fields.map((field) => (
          <Field label={field.label} hint={field.hint && field.hint} key={field.key}>
            {(control) => (
              <select
                {...control}
                value={preview.mapping[field.key] ?? ""}
                disabled={busy}
                onChange={(e) => onChange({ ...preview.mapping, [field.key]: e.target.value === "" ? null : Number(e.target.value) })}
              >
                <option value="">– nicht übernehmen –</option>
                {preview.header.map((name, index) => (
                  <option key={index} value={index}>
                    {name || `Spalte ${index + 1}`}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ))}
      </div>
    </section>
  );
}

function PreviewCard({ preview, busy, meta, onImport }: { preview: Preview; busy: boolean; meta: (typeof KINDS)[number]; onImport: () => void }) {
  const { counts } = preview;
  const order = { fehler: 0, dublette: 1, neu: 2 } as const;
  const rows = [...preview.rows].sort((a, b) => order[a.status] - order[b.status] || a.line - b.line);
  return (
    <section className="card stack" aria-labelledby="csv-preview-heading">
      <h2 id="csv-preview-heading">Vorschau</h2>
      <p style={{ margin: 0 }} role="status">
        {counts.neu} neu, {counts.dublette} {counts.dublette === 1 ? "Dublette" : "Dubletten"}, {counts.fehler} mit Fehlern. Übernommen werden nur die neuen;
        Dubletten und fehlerhafte Zeilen überspringt Haben.
      </p>
      {preview.problem && (
        <div className="banner banner-danger" role="alert">
          {preview.problem}
        </div>
      )}
      <ScrollTable className="report-table">
        <thead>
          <tr>
            <th scope="col" className="num">
              Zeile
            </th>
            <th scope="col">{meta.singular}</th>
            <th scope="col">Ergebnis</th>
            <th scope="col">Hinweis</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, SHOWN_ROWS).map((row) => (
            <tr key={row.line}>
              <td className="num">{row.line}</td>
              <td style={{ overflowWrap: "anywhere" }}>{row.title}</td>
              <td>
                <span className={STATUS[row.status].pill}>{STATUS[row.status].label}</span>
              </td>
              <td className="small" style={{ overflowWrap: "anywhere" }}>
                {row.message ?? ""}
              </td>
            </tr>
          ))}
        </tbody>
      </ScrollTable>
      {rows.length > SHOWN_ROWS && (
        <p className="small muted" style={{ margin: 0 }}>
          Weitere {rows.length - SHOWN_ROWS} neue Zeilen sind nicht aufgeführt.
        </p>
      )}
      <div className="actions">
        <button type="button" className="btn btn-primary" disabled={busy || counts.neu === 0 || preview.problem !== null} onClick={onImport}>
          {counts.neu} {counts.neu === 1 ? meta.singular : meta.plural} übernehmen
        </button>
        <Link to={meta.list} className="btn">
          {meta.back}
        </Link>
      </div>
    </section>
  );
}

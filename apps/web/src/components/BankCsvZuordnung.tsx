import { formatEuro } from "@haben/core";
import {
  BANK_CSV_FIELDS,
  type BankCsvField,
  type BankCsvFile,
  type BankCsvMapping,
  changesDuplicateDetection,
  findSavedHeader,
  headerOf,
  initialMapping,
  parseMappedStatement,
  readBankCsv,
  sameHeader,
  sampleValue,
} from "@haben/import/bank-zuordnung";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { formatDate } from "../lib/format.ts";
import { useAction } from "../lib/use-action.ts";
import { useSubmitCheck } from "../lib/use-submit-check.ts";
import { importBankCsv } from "../server/functions/bank-csv.ts";
import { Field } from "./Field.tsx";
import { FormDialog } from "./FormDialog.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";

export type ImportedCsv = Awaited<ReturnType<typeof importBankCsv>>;
export type ZuordnungKonto = { id: string; name: string; csvMapping: BankCsvMapping | null };

/** Felder nach Gewicht: ohne Pflicht kein Umsatz, die Gegenseite braucht der Abgleich, der Rest ist eingeklappt */
const PFLICHT: readonly BankCsvField[] = ["bookingDate", "amount", "debit", "credit"];
const GEGENSEITE: readonly BankCsvField[] = ["counterpartyName", "counterpartyIban", "purpose"];
const WEITERE: readonly BankCsvField[] = ["valueDate", "currency", "type", "bankReference"];
/** So viele fehlerfreie Zeilen zeigt die Vorschau; Fehler stehen alle davor */
const SHOWN_OK = 5;

type Start = { headerRow: number; mapping: BankCsvMapping; saved: boolean };

/**
 * Spalten einer Bank-CSV zuordnen, die Haben nicht kennt (#1275, docs/bank-spaltenzuordnung.md). Die Vorschau rechnet der Browser mit
 * demselben Parser wie der Server; die Datei geht erst beim Import an den Server. Haben speichert die Zuordnung am
 * Konto, der nächste Export mit derselben Kopfzeile geht ohne diesen Dialog durch.
 */
export function BankCsvZuordnung({
  file,
  accounts,
  accountId,
  onClose,
  onImported,
}: {
  file: File;
  /** Bankkonten ohne Zahlungsdienstleister: die Datei nennt keine IBAN, das Konto wählt man hier */
  accounts: ZuordnungKonto[];
  accountId: string;
  onClose: () => void;
  onImported: (result: ImportedCsv) => void;
}) {
  const importFn = useServerFn(importBankCsv);
  const { busy, notice, setNotice, run } = useAction();
  const [konto, setKonto] = useState(accounts.some((a) => a.id === accountId) ? accountId : "");
  const [csv, setCsv] = useState<BankCsvFile | { error: string } | null>(null);
  const [start, setStart] = useState<Start | null>(null);
  const { form, error, check } = useSubmitCheck({ konto: konto ? null : "Wähle das Konto, zu dem die Datei gehört." });
  const stored = accounts.find((a) => a.id === konto)?.csvMapping ?? null;

  // Die Datei einmal lesen; danach rechnet jede Änderung nur noch im Browser
  // biome-ignore lint/correctness/useExhaustiveDependencies: nur beim Öffnen, Konto und Zuordnung setzt danach der Dialog
  useEffect(() => {
    void file.arrayBuffer().then((buffer) => {
      const read = readBankCsv(new Uint8Array(buffer));
      setCsv(read);
      if (!("error" in read)) setStart(initialMapping(read.records, stored));
    });
  }, [file]);

  const records = csv && !("error" in csv) ? csv.records : null;
  const result = useMemo(() => (records && start ? parseMappedStatement(records, start.headerRow, start.mapping) : null), [records, start]);
  const changeMapping = (patch: Partial<BankCsvMapping>) => start && setStart({ ...start, mapping: { ...start.mapping, ...patch }, saved: false });
  const setColumn = (key: BankCsvField, value: string) =>
    start && changeMapping({ columns: { ...start.mapping.columns, [key]: value === "" ? null : Number(value) } });
  // Die Datei hat die Kopfzeile der Zuordnung am Konto: „Zuordnung ändern“ statt einer unbekannten Bank
  const bekannt = Boolean(stored && start && sameHeader(stored.header, start.mapping.header));
  const changesHashes = bekannt && stored && start && changesDuplicateDetection(stored, start.mapping);
  const ok = result?.rows.filter((r) => r.transaction).length ?? 0;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!check() || !start || !result) return;
    if (result.problem) {
      setNotice({ tone: "danger", text: result.problem });
      return;
    }
    const data = new FormData();
    data.set("file", file);
    data.set("options", JSON.stringify({ accountId: konto, headerRow: start.headerRow, mapping: start.mapping }));
    void run(async () => onImported(await importFn({ data })));
  };

  const columnSelect = (key: BankCsvField) => {
    const field = BANK_CSV_FIELDS.find((f) => f.key === key)!;
    return (
      start &&
      records && (
        <Field label={field.label} hint={"hint" in field ? field.hint : undefined} key={key}>
          {(control) => (
            <select {...control} value={start.mapping.columns[key] ?? ""} onChange={(e) => setColumn(key, e.target.value)}>
              <option value="">– nicht übernehmen –</option>
              {start.mapping.header.map((name, index) => {
                const sample = sampleValue(records, start.headerRow, index);
                return (
                  <option key={index} value={index}>
                    {name || `Spalte ${index + 1}`}
                    {sample && ` – ${sample.slice(0, 30)}`}
                  </option>
                );
              })}
            </select>
          )}
        </Field>
      )
    );
  };

  return (
    <FormDialog open title="Spalten zuordnen" onClose={onClose}>
      <form ref={form} onSubmit={onSubmit} noValidate aria-describedby="csv-zuordnung-intro">
        <p id="csv-zuordnung-intro" className="small muted">
          {bekannt
            ? `„${file.name}“ mit der Zuordnung dieses Kontos. Eine geänderte gilt ab diesem Import.`
            : `Haben kennt das Format von „${file.name}“ nicht. Die Zuordnung merkt sich Haben am Konto.`}
        </p>
        <Field label="Konto" error={error("konto")}>
          {(control) => (
            <select
              {...control}
              value={konto}
              required
              onChange={(e) => {
                setKonto(e.target.value);
                // Nur eine Zuordnung des neuen Kontos für diese Datei ersetzt die gewählte; sonst bleibt, was man schon zugeordnet hat
                const next = accounts.find((a) => a.id === e.target.value)?.csvMapping ?? null;
                if (records && next && findSavedHeader(records, next.header) >= 0) setStart(initialMapping(records, next));
              }}
            >
              <option value="">Konto wählen</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        {csv && "error" in csv && (
          <div className="banner banner-danger" role="alert">
            {csv.error}
          </div>
        )}
        {!csv && <p className="small muted">Datei wird gelesen …</p>}
        {result && <Vorschau result={result} ok={ok} />}
        {start?.saved && <p className="small muted">Zuordnung vom letzten Import in dieses Konto.</p>}
        {changesHashes && (
          <div className="banner banner-info">
            Geändert gegenüber der gespeicherten Zuordnung: Umsätze, die schon importiert sind, erkennt Haben dann nicht mehr als Dubletten.
          </div>
        )}
        {start && records && (
          <>
            <section className="form-section" aria-labelledby="csv-zuordnung-pflicht">
              <h3 id="csv-zuordnung-pflicht">Buchungstag und Betrag</h3>
              <div className="form-grid">{PFLICHT.map(columnSelect)}</div>
            </section>
            <section className="form-section" aria-labelledby="csv-zuordnung-gegenseite">
              <h3 id="csv-zuordnung-gegenseite">Gegenseite</h3>
              <div className="form-grid">{GEGENSEITE.map(columnSelect)}</div>
            </section>
            <details className="form-section" open={Boolean(result?.problem) || undefined}>
              <summary className="small">Weitere Spalten, Kopfzeile und Zahlenformat</summary>
              <div className="form-grid" style={{ marginTop: 12 }}>
                {WEITERE.map(columnSelect)}
                <Field label="Kopfzeile" hint="Die Zeile mit den Spaltennamen">
                  {(control) => (
                    <select {...control} value={start.headerRow} onChange={(e) => setStart(initialMapping(records, stored, Number(e.target.value)))}>
                      {records.slice(0, 40).map((r, index) => (
                        <option key={r.line} value={index}>
                          Zeile {r.line}: {headerOf(r.cells).join(" · ").slice(0, 80)}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="Zahlenformat">
                  {(control) => (
                    <select {...control} value={start.mapping.amountFormat} onChange={(e) => changeMapping({ amountFormat: e.target.value as "de" | "en" })}>
                      <option value="de">1.234,56 (deutsch)</option>
                      <option value="en">1,234.56 (englisch)</option>
                    </select>
                  )}
                </Field>
              </div>
            </details>
          </>
        )}
        <NoticeBanner notice={notice} />
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Importiere …" : `${ok} ${ok === 1 ? "Umsatz" : "Umsätze"} importieren`}
          </button>
        </div>
      </form>
    </FormDialog>
  );
}

function Vorschau({ result, ok }: { result: ReturnType<typeof parseMappedStatement>; ok: number }) {
  const fehler = result.rows.filter((r) => r.errors.length > 0);
  const shown = [...fehler, ...result.rows.filter((r) => r.transaction).slice(0, SHOWN_OK)];
  const hidden = ok - Math.min(ok, SHOWN_OK);
  return (
    <section className="stack" aria-labelledby="csv-zuordnung-vorschau" style={{ gap: 8 }}>
      <h3 id="csv-zuordnung-vorschau" style={{ margin: 0 }}>
        Vorschau
      </h3>
      {result.problem ? (
        <div className="banner banner-danger" role="alert">
          {result.problem}
        </div>
      ) : (
        <p className="small" style={{ margin: 0 }} role="status">
          {ok} {ok === 1 ? "Umsatz" : "Umsätze"}
          {fehler.length > 0 && `, ${fehler.length} ${fehler.length === 1 ? "Zeile" : "Zeilen"} mit Fehlern, die Haben nicht übernimmt`}. Schon vorhandene
          Umsätze überspringt der Import.
        </p>
      )}
      {shown.length > 0 && (
        <ul className="csv-vorschau">
          {shown.map(({ line, errors, transaction }) => (
            <li key={line}>
              {transaction ? (
                <>
                  <span className="csv-vorschau-kopf">
                    <span>{formatDate(transaction.bookingDate)}</span>
                    <span className="num">{formatEuro(transaction.amount)}</span>
                  </span>
                  <span className="small muted">{[transaction.counterpartyName, transaction.purpose].filter(Boolean).join(" · ") || `Zeile ${line}`}</span>
                </>
              ) : (
                <span className="small" style={{ color: "var(--danger-ink)" }}>
                  Zeile {line}: {errors.join(" ")}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 && (
        <p className="small muted" style={{ margin: 0 }}>
          und {hidden} weitere {hidden === 1 ? "Umsatz" : "Umsätze"}
        </p>
      )}
    </section>
  );
}

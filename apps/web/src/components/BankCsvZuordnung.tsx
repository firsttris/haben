import { formatEuro } from "@haben/core";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type FormEvent } from "react";
import { formatDate } from "../lib/format.ts";
import { useAction } from "../lib/use-action.ts";
import { useSubmitCheck } from "../lib/use-submit-check.ts";
import { importBankCsv, previewBankCsv } from "../server/functions/bank-csv.ts";
import { Field } from "./Field.tsx";
import { FormDialog } from "./FormDialog.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { ScrollTable } from "./ScrollTable.tsx";

type Preview = Awaited<ReturnType<typeof previewBankCsv>>;
type Mapping = Preview["mapping"];
export type ImportedCsv = Awaited<ReturnType<typeof importBankCsv>>;

const DELIMITER: Record<string, string> = { ";": "Semikolon", ",": "Komma", "\t": "Tabulator" };
const ENCODING: Record<string, string> = { "utf-8-bom": "UTF-8 mit BOM", "utf-8": "UTF-8", "windows-1252": "Windows-1252", "utf-16": "UTF-16" };

/**
 * Spalten einer Bank-CSV zuordnen, die Haben nicht kennt (#1275, docs/bank.md). Die Vorschau rechnet der Server nach
 * jeder Änderung neu; importiert wird mit der Zuordnung, die die Vorschau gezeigt hat. Haben speichert sie am Konto,
 * der nächste Export mit derselben Kopfzeile geht ohne diesen Dialog durch.
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
  accounts: { id: string; name: string }[];
  accountId: string;
  onClose: () => void;
  onImported: (result: ImportedCsv) => void;
}) {
  const previewFn = useServerFn(previewBankCsv);
  const importFn = useServerFn(importBankCsv);
  const { busy, notice, setNotice, run } = useAction();
  const [konto, setKonto] = useState(accounts.some((a) => a.id === accountId) ? accountId : "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const { form, error, check } = useSubmitCheck({ konto: konto ? null : "Wähle das Konto, zu dem die Datei gehört." });

  const send = (fn: typeof previewFn | typeof importFn, options: { accountId: string; headerRow: number | null; mapping: Mapping | null }) => {
    const data = new FormData();
    data.set("file", file);
    data.set("options", JSON.stringify({ ...options, accountId: options.accountId || null }));
    return fn({ data });
  };
  const show = (options: { accountId: string; headerRow: number | null; mapping: Mapping | null }) =>
    void run(async () => setPreview((await send(previewFn, options)) as Preview));

  // Erste Vorschau mit Vorschlag oder der Zuordnung des Kontos
  // biome-ignore lint/correctness/useExhaustiveDependencies: nur beim Öffnen; danach rechnet jede Änderung selbst neu
  useEffect(() => show({ accountId: konto, headerRow: null, mapping: null }), []);

  const changeMapping = (patch: Partial<Mapping>) =>
    preview && show({ accountId: konto, headerRow: preview.headerRow, mapping: { ...preview.mapping, ...patch } });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!check() || !preview) return;
    if (preview.problem) {
      setNotice({ tone: "danger", text: preview.problem });
      return;
    }
    void run(async () => onImported((await send(importFn, { accountId: konto, headerRow: preview.headerRow, mapping: preview.mapping })) as ImportedCsv));
  };

  return (
    <FormDialog open title="Spalten zuordnen" onClose={onClose}>
      <form ref={form} onSubmit={onSubmit} noValidate aria-describedby="csv-zuordnung-intro">
        <p id="csv-zuordnung-intro" className="small muted">
          Haben kennt das Format von „{file.name}“ nicht. Ordne die Spalten einmal zu; Haben merkt sich die Zuordnung am Konto und liest den nächsten Export mit
          derselben Kopfzeile ohne diesen Schritt.
          {preview && ` Erkannt: ${ENCODING[preview.encoding] ?? preview.encoding}, ${DELIMITER[preview.delimiter] ?? preview.delimiter}.`}
        </p>
        <div className="form-grid">
          <Field label="Konto" error={error("konto")}>
            {(control) => (
              <select
                {...control}
                value={konto}
                required
                disabled={busy}
                onChange={(e) => {
                  setKonto(e.target.value);
                  show({ accountId: e.target.value, headerRow: null, mapping: null });
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
          {preview && (
            <Field label="Kopfzeile" hint="Die Zeile mit den Spaltennamen">
              {(control) => (
                <select
                  {...control}
                  value={preview.headerRow}
                  disabled={busy}
                  onChange={(e) => show({ accountId: konto, headerRow: Number(e.target.value), mapping: null })}
                >
                  {preview.headerChoices.map((c) => (
                    <option key={c.index} value={c.index}>
                      Zeile {c.line}: {c.text}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          {preview && (
            <Field label="Zahlenformat">
              {(control) => (
                <select
                  {...control}
                  value={preview.mapping.amountFormat}
                  disabled={busy}
                  onChange={(e) => changeMapping({ amountFormat: e.target.value as "de" | "en" })}
                >
                  <option value="de">1.234,56 (deutsch)</option>
                  <option value="en">1,234.56 (englisch)</option>
                </select>
              )}
            </Field>
          )}
        </div>
        {preview && (
          <section className="form-section" aria-labelledby="csv-zuordnung-spalten">
            <h3 id="csv-zuordnung-spalten">Spalten</h3>
            {preview.saved && <p className="small muted">Zuordnung vom letzten Import in dieses Konto.</p>}
            <div className="form-grid">
              {preview.fields.map((field) => (
                <Field label={field.label} hint={field.hint} key={field.key}>
                  {(control) => (
                    <select
                      {...control}
                      value={preview.mapping.columns[field.key] ?? ""}
                      disabled={busy}
                      onChange={(e) =>
                        changeMapping({ columns: { ...preview.mapping.columns, [field.key]: e.target.value === "" ? null : Number(e.target.value) } })
                      }
                    >
                      <option value="">– nicht übernehmen –</option>
                      {preview.mapping.header.map((name, index) => (
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
        )}
        {preview && <Vorschau preview={preview} />}
        <NoticeBanner notice={notice} />
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {preview ? `${preview.counts.ok} ${preview.counts.ok === 1 ? "Umsatz" : "Umsätze"} importieren` : "Importieren"}
          </button>
        </div>
      </form>
    </FormDialog>
  );
}

function Vorschau({ preview }: { preview: Preview }) {
  const { counts } = preview;
  return (
    <section className="stack" aria-labelledby="csv-zuordnung-vorschau">
      <h3 id="csv-zuordnung-vorschau" style={{ margin: 0 }}>
        Vorschau
      </h3>
      {preview.problem ? (
        <div className="banner banner-danger" role="alert">
          {preview.problem}
        </div>
      ) : (
        <p className="small" style={{ margin: 0 }} role="status">
          {counts.ok} {counts.ok === 1 ? "Umsatz" : "Umsätze"}
          {counts.fehler > 0 && `, ${counts.fehler} ${counts.fehler === 1 ? "Zeile" : "Zeilen"} mit Fehlern, die Haben nicht übernimmt`}. Schon vorhandene
          Umsätze überspringt der Import.
        </p>
      )}
      {preview.rows.length > 0 && (
        <ScrollTable className="report-table">
          <thead>
            <tr>
              <th scope="col" className="num">
                Zeile
              </th>
              <th scope="col">Buchungstag</th>
              <th scope="col" className="num">
                Betrag
              </th>
              <th scope="col">Gegenseite · Verwendungszweck</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => (
              <tr key={row.line}>
                <td className="num">{row.line}</td>
                <td>{row.bookingDate ? formatDate(row.bookingDate) : ""}</td>
                <td className="num">{row.amount === null ? "" : formatEuro(row.amount)}</td>
                <td style={{ overflowWrap: "anywhere" }}>
                  {row.errors.length > 0 ? (
                    <span style={{ color: "var(--danger-ink)" }}>{row.errors.join(" ")}</span>
                  ) : (
                    [row.counterpartyName, row.purpose].filter(Boolean).join(" · ")
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      )}
    </section>
  );
}

import { formatDecimal, parseEuro, TAX_TREATMENTS, type TaxTreatment } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { adoptForeignInvoiceFn, readForeignInvoice } from "../server/functions/fremdrechnung.ts";
import { Field } from "./Field.tsx";

type Read = Awaited<ReturnType<typeof readForeignInvoice>>;
type TaxRow = { rate: string; net: string; tax: string };

const RATES = [
  { value: "1900", label: "19 %" },
  { value: "700", label: "7 %" },
  { value: "0", label: "0 %" },
];

/**
 * Rechnung aus einem Fremdsystem übernehmen (#660): Original-PDF wählen, die Angaben prüfen (bei einer E-Rechnung kommen sie
 * aus der Datei) und übernehmen. Nummer und PDF bleiben, gebucht wird wie beim Festschreiben einer eigenen Rechnung.
 */
export function ForeignInvoiceImport({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [read, setRead] = useState<Read | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(next: File | null) {
    setFile(next);
    setRead(null);
    setError(null);
    if (!next) return;
    const form = new FormData();
    form.set("file", next);
    try {
      setRead(await readForeignInvoice({ data: form }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Die Datei lässt sich nicht lesen.");
    }
  }

  return (
    <section className="card" aria-labelledby="fremdrechnung-heading" style={{ maxWidth: 720 }}>
      <h2 id="fremdrechnung-heading">Rechnung aus einem Fremdsystem übernehmen</h2>
      <p className="muted">
        Für Rechnungen, die ein anderes Programm geschrieben und verschickt hat. Nummer und PDF bleiben unverändert, die Rechnung wird wie eine eigene gebucht
        und läuft danach durch Bankabgleich und Mahnwesen.
      </p>
      {error && (
        <div className="banner banner-danger" role="alert">
          {error}
        </div>
      )}
      <Field label="Original der Rechnung (PDF, auch ZUGFeRD)">
        {(control) => <input {...control} type="file" accept="application/pdf,.pdf" onChange={(e) => void choose(e.target.files?.[0] ?? null)} />}
      </Field>
      {file && read && <ForeignInvoiceForm file={file} read={read} onClose={onClose} />}
    </section>
  );
}

function ForeignInvoiceForm({ file, read, onClose }: { file: File; read: Read; onClose: () => void }) {
  const router = useRouter();
  const p = read.proposal;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [number, setNumber] = useState(p.number);
  const [issueDate, setIssueDate] = useState(p.issueDate);
  const [dueDate, setDueDate] = useState(p.dueDate);
  const [serviceFrom, setServiceFrom] = useState(p.serviceFrom ?? "");
  const [serviceTo, setServiceTo] = useState(p.serviceTo ?? "");
  const [contactId, setContactId] = useState(p.contactId ?? "");
  const [treatment, setTreatment] = useState<TaxTreatment>(p.taxTreatment);
  const [exemptionReason, setExemptionReason] = useState("");
  const [rows, setRows] = useState<TaxRow[]>(
    p.taxes.length > 0
      ? p.taxes.map((t) => ({ rate: String(t.rate), net: formatDecimal(t.net), tax: formatDecimal(t.tax) }))
      : [{ rate: "1900", net: "", tax: "" }],
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const taxes = rows.map((r) => ({ rate: Number(r.rate), net: parseEuro(r.net), tax: parseEuro(r.tax) }));
    if (taxes.some((t) => t.net === null || t.tax === null)) {
      setError("Netto und Steuer bitte als Betrag in Euro eintragen, etwa 1.000,00.");
      return;
    }
    const form = new FormData();
    form.set("file", file);
    form.set(
      "rechnung",
      JSON.stringify({
        number,
        issueDate,
        dueDate,
        contactId,
        taxTreatment: treatment,
        exemptionReason,
        serviceFrom: serviceFrom || null,
        serviceTo: serviceTo || null,
        taxes,
      }),
    );
    setBusy(true);
    setError(null);
    try {
      const { id } = await adoptForeignInvoiceFn({ data: form });
      await router.navigate({ to: "/rechnungen/$id", params: { id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Die Rechnung konnte nicht übernommen werden.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} aria-label="Angaben zur Rechnung">
      {p.warnings.map((w) => (
        <div key={w} className="banner banner-warn" role="status">
          {w}
        </div>
      ))}
      {error && (
        <div className="banner banner-danger" role="alert">
          {error}
        </div>
      )}
      <Field label="Rechnungsnummer">{(control) => <input {...control} value={number} onChange={(e) => setNumber(e.target.value)} required />}</Field>
      <Field label="Rechnungsdatum">
        {(control) => <input {...control} type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} required />}
      </Field>
      <Field label="Fällig am">{(control) => <input {...control} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />}</Field>
      <Field
        label="Leistung von (optional)"
        hint="Bei Soll-Versteuerung entscheidet der Leistungszeitraum, in welcher Voranmeldung die Umsatzsteuer steht. Ohne Angabe gilt das Rechnungsdatum."
      >
        {(control) => <input {...control} type="date" value={serviceFrom} onChange={(e) => setServiceFrom(e.target.value)} />}
      </Field>
      <Field label="Leistung bis (optional)">
        {(control) => <input {...control} type="date" value={serviceTo} onChange={(e) => setServiceTo(e.target.value)} />}
      </Field>
      <Field label="Kunde" hint={p.buyerName && !p.contactId ? `Auf der Rechnung: ${p.buyerName}. Dazu gibt es keinen eindeutigen Kontakt.` : undefined}>
        {(control) => (
          <select {...control} value={contactId} onChange={(e) => setContactId(e.target.value)} required>
            <option value="">Bitte wählen</option>
            {read.customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.ort ? `${c.name}, ${c.ort}` : c.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Steuerbehandlung">
        {(control) => (
          <select {...control} value={treatment} onChange={(e) => setTreatment(e.target.value as TaxTreatment)}>
            {Object.entries(TAX_TREATMENTS)
              .filter(([key]) => key !== "eu_sonstige")
              .map(([key, t]) => (
                <option key={key} value={key}>
                  {t.label}
                </option>
              ))}
          </select>
        )}
      </Field>
      {(treatment === "steuerfrei" || treatment === "kleinunternehmer") && (
        <Field label="Befreiungsvorschrift" hint="Wie auf der Rechnung, etwa „Steuerfrei nach § 4 Nr. 14 UStG“">
          {(control) => <input {...control} value={exemptionReason} onChange={(e) => setExemptionReason(e.target.value)} required />}
        </Field>
      )}
      <TaxRowFields rows={rows} onChange={setRows} />
      <div className="actions">
        <button type="button" className="btn" onClick={() => setRows([...rows, { rate: "0", net: "", tax: "0,00" }])}>
          Weiteren Steuersatz
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Übernehmen
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}

function TaxRowFields({ rows, onChange }: { rows: TaxRow[]; onChange: (rows: TaxRow[]) => void }) {
  const set = (i: number, patch: Partial<TaxRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return rows.map((row, i) => (
    <div key={i} className="field-row">
      <Field label={`Steuersatz ${i + 1}`}>
        {(control) => (
          <select {...control} value={row.rate} onChange={(e) => set(i, { rate: e.target.value })}>
            {RATES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={`Netto ${i + 1} (€)`}>
        {(control) => <input {...control} inputMode="decimal" value={row.net} onChange={(e) => set(i, { net: e.target.value })} required />}
      </Field>
      <Field label={`Steuer ${i + 1} (€)`}>
        {(control) => <input {...control} inputMode="decimal" value={row.tax} onChange={(e) => set(i, { tax: e.target.value })} required />}
      </Field>
    </div>
  ));
}

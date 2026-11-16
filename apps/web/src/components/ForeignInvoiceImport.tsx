import { formatDecimal, parseEuro, TAX_TREATMENTS, type TaxTreatment } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { adoptForeignInvoiceFn, readForeignInvoice } from "../server/functions/fremdrechnung.ts";
import { ContactCombobox, savedAsChoice } from "./ContactCombobox.tsx";
import { Field } from "./Field.tsx";
import { FilePicker } from "./FilePicker.tsx";
import { NewContactDialog } from "./NewContactDialog.tsx";

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
  const [read, setRead] = useState<{ file: File; data: Read } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(file: File | null) {
    setRead(null);
    setError(null);
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    try {
      setRead({ file, data: await readForeignInvoice({ data: form }) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Die Datei lässt sich nicht lesen.");
    }
  }

  return (
    <section className="card form-card" aria-labelledby="fremdrechnung-heading" style={{ maxWidth: 720 }}>
      <div className="form-card-head">
        <h2 id="fremdrechnung-heading">Ausgangsrechnung hochladen</h2>
        <p className="muted">
          Für Rechnungen, die ein anderes Programm geschrieben und verschickt hat. Nummer und PDF bleiben unverändert, die Rechnung wird wie eine eigene gebucht
          und läuft danach durch Bankabgleich und Mahnwesen.
        </p>
      </div>
      <div className="form-section">
        {error && (
          <div className="banner banner-danger" role="alert">
            {error}
          </div>
        )}
        <Field label="Original der Rechnung (PDF, auch ZUGFeRD)">
          {(control) => <FilePicker {...control} accept="application/pdf,.pdf" onChange={(e) => void choose(e.target.files?.[0] ?? null)} />}
        </Field>
      </div>
      {read ? (
        <ForeignInvoiceForm key={read.file.name + read.file.size + read.file.lastModified} file={read.file} read={read.data} onClose={onClose} />
      ) : (
        <div className="actions form-footer">
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
        </div>
      )}
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
  const [customers, setCustomers] = useState(read.customers);
  const [contactId, setContactId] = useState(p.contactId ?? "");
  /** Offener Dialog „Neuer Kunde“ mit dem vorgetragenen Namen; null = geschlossen */
  const [newContactName, setNewContactName] = useState<string | null>(null);
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
    if (!contactId) {
      setError("Bitte einen Kunden wählen oder neu anlegen.");
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
    <>
      <form onSubmit={(e) => void submit(e)} aria-label="Angaben zur Rechnung" style={{ display: "flex", flexDirection: "column" }}>
        {(p.warnings.length > 0 || error) && (
          <div className="form-section">
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
          </div>
        )}
        <section className="form-section" aria-labelledby="fremdrechnung-basis">
          <h2 id="fremdrechnung-basis">Rechnung</h2>
          <div className="form-grid">
            <Field label="Rechnungsnummer">{(control) => <input {...control} value={number} onChange={(e) => setNumber(e.target.value)} required />}</Field>
            <Field label="Rechnungsdatum">
              {(control) => <input {...control} type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} required />}
            </Field>
            <Field label="Fällig am">
              {(control) => <input {...control} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />}
            </Field>
            <Field
              label="Leistung von"
              hint="Nur wenn die Leistung in einem anderen Monat liegt als das Rechnungsdatum: Bei Soll-Versteuerung zählt der Monat der Leistung"
            >
              {(control) => <input {...control} type="date" value={serviceFrom} onChange={(e) => setServiceFrom(e.target.value)} />}
            </Field>
            <Field label="Leistung bis">
              {(control) => <input {...control} type="date" value={serviceTo} onChange={(e) => setServiceTo(e.target.value)} />}
            </Field>
          </div>
        </section>
        <section className="form-section" aria-labelledby="fremdrechnung-kunde">
          <h2 id="fremdrechnung-kunde">Kunde</h2>
          <Field label="Kunde" hint={p.buyerName && !p.contactId ? `Auf der Rechnung: ${p.buyerName}. Dazu gibt es keinen eindeutigen Kontakt.` : undefined}>
            {(control) => (
              <ContactCombobox
                {...control}
                rolle="kunde"
                contacts={customers}
                contactId={contactId}
                required
                onChoose={setContactId}
                onCreate={(name) => setNewContactName(name || p.buyerName || "")}
              />
            )}
          </Field>
          <div className="actions">
            <button type="button" className="btn btn-sm" onClick={() => setNewContactName(p.buyerName ?? "")}>
              Neuen Kunden anlegen
            </button>
          </div>
        </section>
        <section className="form-section" aria-labelledby="fremdrechnung-steuer">
          <h2 id="fremdrechnung-steuer">Steuer</h2>
          <Field label="Steuerbehandlung">
            {(control) => (
              <select {...control} value={treatment} onChange={(e) => setTreatment(e.target.value as TaxTreatment)}>
                {Object.entries(TAX_TREATMENTS).map(([key, t]) => (
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
            <button type="button" className="btn btn-sm" onClick={() => setRows([...rows, { rate: "0", net: "", tax: "0,00" }])}>
              Weiteren Steuersatz
            </button>
          </div>
        </section>
        <div className="actions form-footer">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Übernehmen
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
        </div>
      </form>
      {/* Neben dem Formular, nicht darin: Das Formular im Dialog schickte sonst auch dieses ab */}
      <NewContactDialog
        rolle="kunde"
        name={newContactName}
        onSaved={(saved) => {
          setCustomers((list) => [...list.filter((c) => c.id !== saved.id), savedAsChoice(saved)]);
          setContactId(saved.id);
        }}
        onPickExisting={setContactId}
        onClose={() => setNewContactName(null)}
      />
    </>
  );
}

function TaxRowFields({ rows, onChange }: { rows: TaxRow[]; onChange: (rows: TaxRow[]) => void }) {
  const set = (i: number, patch: Partial<TaxRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return rows.map((row, i) => (
    // Zeilen werden nur angehängt, nie umsortiert: der Index ist ein stabiler Schlüssel
    <div key={i} className="form-grid">
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

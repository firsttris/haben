import { amountError, formatDecimal, parseEuro, TAX_TREATMENTS, type TaxTreatment } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { UmsatzgrenzeBestaetigung } from "../lib/kleinunternehmer.ts";
import { adoptForeignInvoiceFn, readForeignInvoice } from "../server/functions/fremdrechnung.ts";
import { treatmentHint } from "./OutgoingTaxFields.tsx";
import { ContactCombobox, savedAsChoice } from "./ContactCombobox.tsx";
import { Field } from "./Field.tsx";
import { FilePicker } from "./FilePicker.tsx";
import { NewContactDialog } from "./NewContactDialog.tsx";
import { UmsatzgrenzeDialog } from "./UmsatzgrenzeDialog.tsx";

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

/** Absenden an den Server; meldet er die Umsatzgrenze, wartet die Rechnung auf die Bestätigung (`pending`) */
function useAdopt(file: File) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ payload: object; warning: UmsatzgrenzeBestaetigung } | null>(null);

  async function adopt(payload: object) {
    const form = new FormData();
    form.set("file", file);
    form.set("rechnung", JSON.stringify(payload));
    setBusy(true);
    setError(null);
    try {
      const result = await adoptForeignInvoiceFn({ data: form });
      if (result.status === "umsatzgrenze") {
        const { umsatz, rechnung, grenze, vorjahresumsatz } = result;
        setPending({ payload, warning: { umsatz, rechnung, grenze, ...(vorjahresumsatz === undefined ? {} : { vorjahresumsatz }) } });
        setBusy(false);
        return;
      }
      await router.navigate({ to: "/rechnungen/$id", params: { id: result.id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Die Rechnung konnte nicht übernommen werden.");
      setBusy(false);
    }
  }
  return { error, setError, busy, pending, setPending, adopt };
}

function ForeignInvoiceForm({ file, read, onClose }: { file: File; read: Read; onClose: () => void }) {
  const p = read.proposal;
  const { error, setError, busy, pending, setPending, adopt } = useAdopt(file);
  const [basics, setBasics] = useState<Basics>({
    number: p.number,
    issueDate: p.issueDate,
    dueDate: p.dueDate,
    serviceFrom: p.serviceFrom ?? "",
    serviceTo: p.serviceTo ?? "",
  });
  const [customers, setCustomers] = useState(read.customers);
  const [contactId, setContactId] = useState(p.contactId ?? "");
  /** Offener Dialog „Neuer Kunde“ mit dem vorgetragenen Namen; null = geschlossen */
  const [newContactName, setNewContactName] = useState<string | null>(null);
  const [treatment, setTreatment] = useState<TaxTreatment>(read.kleinunternehmer ? "kleinunternehmer" : p.taxTreatment);
  const [exemptionReason, setExemptionReason] = useState("");
  const [rows, setRows] = useState<TaxRow[]>(
    p.taxes.length > 0
      ? p.taxes.map((t) => ({ rate: String(t.rate), net: formatDecimal(t.net), tax: formatDecimal(t.tax) }))
      : [{ rate: "1900", net: "", tax: "" }],
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const taxes = rows.map((r) => ({ rate: Number(r.rate), net: parseEuro(r.net), tax: parseEuro(r.tax) }));
    if (taxes.some((t) => t.net === null || t.tax === null || t.net < 0 || t.tax < 0)) {
      setError(amountError("Netto und Steuer als Betrag ab 0", 100_000));
      return;
    }
    if (!contactId) {
      setError("Bitte einen Kunden wählen oder neu anlegen.");
      return;
    }
    await adopt({
      number: basics.number,
      issueDate: basics.issueDate,
      dueDate: basics.dueDate,
      contactId,
      taxTreatment: treatment,
      exemptionReason,
      serviceFrom: basics.serviceFrom || null,
      serviceTo: basics.serviceTo || null,
      taxes,
    });
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
        <BasicsSection value={basics} onChange={setBasics} />
        <CustomerSection proposal={p} customers={customers} contactId={contactId} onContactId={setContactId} onNewContact={setNewContactName} />
        <TaxSection
          treatment={treatment}
          onTreatment={setTreatment}
          kleinunternehmer={read.kleinunternehmer}
          exemptionReason={exemptionReason}
          onExemptionReason={setExemptionReason}
          rows={rows}
          onRows={setRows}
        />
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
      {pending && (
        <UmsatzgrenzeDialog
          warnung={pending.warning}
          action="übernehmen"
          onClose={() => setPending(null)}
          onConfirm={() => void adopt({ ...pending.payload, bestaetigt: pending.warning })}
        >
          <p>Bei Abbruch wird nichts übernommen.</p>
        </UmsatzgrenzeDialog>
      )}
    </>
  );
}

/** Kunde wählen oder anlegen; der Dialog „Neuer Kunde“ steht neben dem Formular (siehe ForeignInvoiceForm) */
function CustomerSection({
  proposal,
  customers,
  contactId,
  onContactId,
  onNewContact,
}: {
  proposal: Read["proposal"];
  customers: Read["customers"];
  contactId: string;
  onContactId: (id: string) => void;
  /** Öffnet den Dialog mit diesem Namen als Vorgabe */
  onNewContact: (name: string) => void;
}) {
  return (
    <section className="form-section" aria-labelledby="fremdrechnung-kunde">
      <h2 id="fremdrechnung-kunde">Kunde</h2>
      <Field
        label="Kunde"
        hint={proposal.buyerName && !proposal.contactId ? `Auf der Rechnung: ${proposal.buyerName}. Dazu gibt es keinen eindeutigen Kontakt.` : undefined}
      >
        {(control) => (
          <ContactCombobox
            {...control}
            rolle="kunde"
            contacts={customers}
            contactId={contactId}
            required
            onChoose={onContactId}
            onCreate={(name) => onNewContact(name || proposal.buyerName || "")}
          />
        )}
      </Field>
      <div className="actions">
        <button type="button" className="btn btn-sm" onClick={() => onNewContact(proposal.buyerName ?? "")}>
          Neuen Kunden anlegen
        </button>
      </div>
    </section>
  );
}

type Basics = { number: string; issueDate: string; dueDate: string; serviceFrom: string; serviceTo: string };

function BasicsSection({ value, onChange }: { value: Basics; onChange: (value: Basics) => void }) {
  const set = (patch: Partial<Basics>) => onChange({ ...value, ...patch });
  return (
    <section className="form-section" aria-labelledby="fremdrechnung-basis">
      <h2 id="fremdrechnung-basis">Rechnung</h2>
      <div className="form-grid">
        <Field label="Rechnungsnummer">
          {(control) => <input {...control} value={value.number} onChange={(e) => set({ number: e.target.value })} required />}
        </Field>
        <Field label="Rechnungsdatum">
          {(control) => <input {...control} type="date" value={value.issueDate} onChange={(e) => set({ issueDate: e.target.value })} required />}
        </Field>
        <Field label="Fällig am">
          {(control) => <input {...control} type="date" value={value.dueDate} onChange={(e) => set({ dueDate: e.target.value })} required />}
        </Field>
        <Field
          label="Leistung von"
          hint="Nur wenn die Leistung in einem anderen Monat liegt als das Rechnungsdatum: Bei Soll-Versteuerung zählt der Monat der Leistung"
        >
          {(control) => <input {...control} type="date" value={value.serviceFrom} onChange={(e) => set({ serviceFrom: e.target.value })} />}
        </Field>
        <Field label="Leistung bis">
          {(control) => <input {...control} type="date" value={value.serviceTo} onChange={(e) => set({ serviceTo: e.target.value })} />}
        </Field>
      </div>
    </section>
  );
}

/**
 * Behandlungen, die die Übernahme annimmt: Ein Kleinunternehmer übernimmt nur Rechnungen nach § 19 UStG, alle anderen nicht diese.
 * Sonstige Leistungen im EU-Ausland und die übrigen Befreiungen von Kleinunternehmern brauchen strukturierte Angaben (Leistungsort,
 * Vorschrift), die das Formular nicht abfragt; der Server lehnt sie ab, also werden sie nicht angeboten.
 */
function offeredTreatments(kleinunternehmer: boolean): TaxTreatment[] {
  const all = Object.keys(TAX_TREATMENTS) as TaxTreatment[];
  return kleinunternehmer ? ["kleinunternehmer"] : all.filter((key) => key !== "eu_sonstige" && key !== "kleinunternehmer");
}

function TaxSection({
  treatment,
  onTreatment,
  kleinunternehmer,
  exemptionReason,
  onExemptionReason,
  rows,
  onRows,
}: {
  treatment: TaxTreatment;
  kleinunternehmer: boolean;
  onTreatment: (treatment: TaxTreatment) => void;
  exemptionReason: string;
  onExemptionReason: (reason: string) => void;
  rows: TaxRow[];
  onRows: (rows: TaxRow[]) => void;
}) {
  return (
    <section className="form-section" aria-labelledby="fremdrechnung-steuer">
      <h2 id="fremdrechnung-steuer">Steuer</h2>
      <Field
        label="Steuerbehandlung"
        hint={kleinunternehmer ? "Als Kleinunternehmer übernimmt Haben hier nur Rechnungen nach § 19 UStG." : treatmentHint(treatment, false)}
      >
        {(control) => (
          <select {...control} value={treatment} onChange={(e) => onTreatment(e.target.value as TaxTreatment)}>
            {offeredTreatments(kleinunternehmer).map((key) => (
              <option key={key} value={key}>
                {TAX_TREATMENTS[key].label}
              </option>
            ))}
          </select>
        )}
      </Field>
      {(treatment === "steuerfrei" || treatment === "kleinunternehmer") && (
        <Field label="Befreiungsvorschrift" hint="Wie auf der Rechnung, etwa „Steuerfrei nach § 4 Nr. 14 UStG“">
          {(control) => (
            <input {...control} value={exemptionReason} onChange={(e) => onExemptionReason(e.target.value)} required={treatment === "steuerfrei"} />
          )}
        </Field>
      )}
      <TaxRowFields rows={rows} onChange={onRows} />
      <div className="actions">
        <button type="button" className="btn btn-sm" onClick={() => onRows([...rows, { rate: "0", net: "", tax: "0,00" }])}>
          Weiteren Steuersatz
        </button>
      </div>
    </section>
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

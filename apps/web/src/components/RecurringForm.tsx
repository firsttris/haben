import {
  type OutgoingTaxDetails,
  outgoingTaxIssues,
  type PaymentMethod,
  type PriceMode,
  type RecurringInterval,
  type ServicePeriodMode,
  section4Note,
  servicePeriodFor,
  type TaxTreatment,
  lineAmount,
} from "@haben/core";
import { type FormEvent, useState } from "react";
import { positionsFehler } from "../lib/editor-lines.ts";
import type { InvoiceFormat } from "../lib/invoice.ts";
import { useSubmitCheck } from "../lib/use-submit-check.ts";
import type { ContactChoice } from "./ContactCombobox.tsx";
import { NewContactDialog } from "./NewContactDialog.tsx";
import { PropertyRetentionField } from "./PropertyRetentionField.tsx";
import {
  type FormState,
  RecurringBasics,
  RecurringPayment,
  RecurringPreview,
  RecurringRunMode,
  RecurringSchedule,
  RecurringTax,
} from "./RecurringFormParts.tsx";
import { type LineState, lineState, parseLine, RecurringPositions, type RecurringLine } from "./RecurringLines.tsx";
import { TextBlockField, type TextBlockOption } from "./TextBlockField.tsx";

export interface RecurringValues {
  name: string;
  active: boolean;
  contactId: string;
  format: InvoiceFormat;
  paymentTermDays: number;
  intro: string;
  note: string;
  propertyRetention: boolean;
  taxTreatment: TaxTreatment;
  exemptionReason: string;
  taxDetails: OutgoingTaxDetails | null;
  priceMode: PriceMode;
  lines: RecurringLine[];
  intervalMonths: RecurringInterval;
  nextDate: string;
  endDate: string | null;
  servicePeriod: ServicePeriodMode;
  mode: "entwurf" | "festschreiben";
  sendByMail: boolean;
  /** Überweisung oder Lastschrift (#445); das Mandat wählt jeder Lauf selbst */
  paymentMethod: PaymentMethod;
}

/** Formular für eine Vorlage; Platzhalter wie {monat} werden in der Vorschau ersetzt */
export function RecurringForm({
  initial,
  contacts,
  textBlocks = [],
  units = [],
  kleinunternehmer,
  busy,
  submitLabel,
  onSubmit,
}: {
  initial: RecurringValues;
  /** Nur Kunden stehen zur Auswahl; der gewählte bleibt sichtbar */
  contacts: ContactChoice[];
  /** Kopf- und Fußtexte zum Einfügen */
  textBlocks?: TextBlockOption[];
  /** Eigene Einheiten (#748) neben den festen */
  units?: readonly string[];
  kleinunternehmer: boolean;
  busy: boolean;
  submitLabel: string;
  onSubmit: (values: RecurringValues) => void;
}) {
  const [v, setV] = useState<FormState>(() => formState(initial));
  const set = (patch: Partial<FormState>) => setV((prev) => ({ ...prev, ...patch }));
  /** Getippter Name, wenn der Dialog für einen neuen Kunden offen ist; null = geschlossen */
  const [newContactName, setNewContactName] = useState<string | null>(null);
  const [lines, setLines] = useState<LineState[]>(() => initial.lines.map(lineState));

  const special = v.taxTreatment !== "regulaer";
  /** Bruttopreise nur mit Steuerausweis */
  const grossPrices = !special && v.priceMode === "brutto";
  const amountLabel = grossPrices ? "Brutto" : "Netto";
  const parsed = lines.map((line) => parseLine(line, special));
  const taxNote = v.taxTreatment === "steuerfrei" ? (section4Note(v.taxDetails?.exemption) ?? v.exemptionReason) : v.exemptionReason;
  const fehler = recurringErrors(v, lines, outgoingTaxIssues(v.taxTreatment, v.taxDetails, kleinunternehmer), taxNote);
  const valid = parsed.length > 0 && parsed.every((l) => l.valid) && Object.values(fehler).every((e) => e === null);
  const { form, error, check } = useSubmitCheck(fehler);

  const period = v.nextDate ? servicePeriodFor(v.nextDate, v.intervalMonths, v.servicePeriod) : null;
  const reference = period ?? (v.nextDate ? { from: v.nextDate, to: v.nextDate } : null);
  const sum = parsed.reduce((s, l) => s + (l.valid ? lineAmount(l.quantity, l.unitPrice) : 0), 0);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!check() || !valid) return;
    onSubmit({
      ...v,
      name: v.name.trim(),
      paymentTermDays: Number(v.paymentTermDays),
      exemptionReason: special ? taxNote : "",
      priceMode: grossPrices ? "brutto" : "netto",
      lines: parsed.map(({ valid: _valid, ...line }) => line),
      endDate: v.endDate || null,
      sendByMail: v.mode === "festschreiben" && v.sendByMail,
    });
  }

  const textBlock = (label: string, kind: "kopf" | "fuss", value: string, field: "intro" | "note") => (
    <TextBlockField label={label} kind={kind} value={value} onChange={(text) => set({ [field]: text })} blocks={textBlocks} contactId={v.contactId || null} />
  );

  return (
    <>
      <form ref={form} className="stack" onSubmit={submit} noValidate>
        <section className="card form-card" aria-label="Vorlage">
          <RecurringBasics v={v} set={set} error={error} contacts={contacts} onCreateContact={setNewContactName} />
          <RecurringSchedule v={v} set={set} error={error} />
          <div className="form-section" role="group" aria-labelledby="recurring-invoice">
            <h2 id="recurring-invoice">Rechnung</h2>
            <RecurringPayment v={v} set={set} error={error} />
            <RecurringTax v={v} set={set} error={error} kleinunternehmer={kleinunternehmer} />
          </div>
          <RecurringRunMode v={v} set={set} />
        </section>

        <RecurringPositions
          lines={lines}
          setLines={setLines}
          parsed={parsed}
          special={special}
          amountLabel={amountLabel}
          units={units}
          error={error}
          kopf={textBlock("Einleitung über den Positionen (optional)", "kopf", v.intro, "intro")}
          fuss={
            <>
              {textBlock("Hinweis auf der Rechnung (optional)", "fuss", v.note, "note")}
              <PropertyRetentionField checked={v.propertyRetention} onChange={(propertyRetention) => set({ propertyRetention })} />
            </>
          }
        />

        {reference && (
          <RecurringPreview
            nextDate={v.nextDate}
            period={period}
            reference={reference}
            amountLabel={amountLabel}
            sum={sum}
            parsed={parsed}
            special={special}
            taxTreatment={v.taxTreatment}
            taxNote={taxNote}
          />
        )}

        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {submitLabel}
          </button>
        </div>
      </form>
      <NewContactDialog
        rolle="kunde"
        name={newContactName}
        onSaved={(saved) => set({ contactId: saved.id })}
        onPickExisting={(contactId) => set({ contactId })}
        onClose={() => setNewContactName(null)}
      />
    </>
  );
}

/** Stand zum Bearbeiten aus den gespeicherten Werten; die Positionen führt das Formular getrennt */
function formState({ lines: _lines, ...values }: RecurringValues): FormState {
  return { ...values, paymentTermDays: String(values.paymentTermDays), endDate: values.endDate ?? "", taxDetails: values.taxDetails ?? null };
}

/** Fehler je Feld für die Prüfung beim Speichern; null, wo alles stimmt */
function recurringErrors(v: FormState, lines: LineState[], taxIssues: string[], taxNote: string): Record<string, string | null> {
  const term = Number(v.paymentTermDays);
  return {
    ...Object.fromEntries(lines.map((l) => [`pos-${l.key}`, positionsFehler(l)])),
    name: v.name.trim() === "" ? "Trag eine Bezeichnung ein, etwa Wartungsvertrag Nordwerk." : null,
    contact: v.contactId === "" ? "Wähle den Kunden." : null,
    nextDate: v.nextDate ? null : "Wähle den Tag der nächsten Rechnung.",
    endDate: v.endDate && v.endDate < v.nextDate ? "Wähle einen Tag ab der nächsten Rechnung." : null,
    term: Number.isInteger(term) && term >= 0 && term <= 120 ? null : "Trag das Zahlungsziel in ganzen Tagen von 0 bis 120 ein.",
    tax: taxIssues[0] ?? null,
    exemption: v.taxTreatment === "steuerfrei" && !taxNote.trim() ? "Trag die Befreiungsvorschrift ein, etwa § 4 Nr. 14 UStG." : null,
  };
}

import {
  dauerbelegSummen,
  formatDecimal,
  formatEuro,
  ownerLabels,
  parseEuro,
  RECURRING_INTERVALS,
  VORSTEUER_HINWEIS,
  type RecurringInterval,
  type Rechtsform,
} from "@haben/core";
import { useRef, useState, type FormEvent } from "react";
import { FilePicker } from "./FilePicker.tsx";
import { Icon } from "./Icon.tsx";
import { ContactCombobox, savedAsChoice, type ContactChoice } from "./ContactCombobox.tsx";
import { NewContactDialog } from "./NewContactDialog.tsx";
import { Field } from "./Field.tsx";

type Rate = 1900 | 700 | 0;

export interface DauerbelegValues {
  name: string;
  supplierName: string;
  supplierUstId: string;
  supplierContactId: string | null;
  reference: string;
  category: string;
  payment: "bank" | "privat" | "kasse";
  privateShare: number;
  amounts: { taxRate: Rate; net: number; tax: number }[];
  taxShown: boolean;
  note: string;
  intervalMonths: RecurringInterval;
  nextDate: string;
  endDate: string | null;
  dueDays: number;
}

interface AmountState {
  key: number;
  taxRate: Rate;
  net: string;
  tax: string;
  /** Steuer von Hand geändert: dann nicht mehr aus dem Netto rechnen */
  taxEdited: boolean;
}

let nextKey = 1;

const RATES: Rate[] = [1900, 700, 0];
/** Aus eigenem Geld bezahlt heißt je nach Rechtsform Privateinlage oder Verrechnungskonto des Gesellschafters */
const paymentLabels = (rechtsform: Rechtsform) =>
  ({ bank: "Über das Geschäftskonto (Bankabgleich)", privat: ownerLabels(rechtsform).documentPaid, kasse: "Bar aus der Kasse" }) as const;

const taxOf = (net: number | null, rate: Rate) => (net === null ? 0 : Math.round((net * rate) / 10_000));

/**
 * Formular für einen Dauerbeleg: Lieferant, Kategorie, Beträge je Steuersatz, Intervall und Vertrag. Beim Anlegen ist der
 * Vertrag Pflicht, beim Ändern ersetzt eine neue Datei ihn nur für künftige Belege.
 */
export function DauerbelegForm({
  initial,
  suppliers,
  categories,
  kleinunternehmer,
  rechtsform,
  isNew,
  busy,
  submitLabel,
  onSubmit,
}: {
  initial: DauerbelegValues;
  suppliers: ContactChoice[];
  categories: { value: string; label: string }[];
  kleinunternehmer: boolean;
  rechtsform: Rechtsform;
  isNew: boolean;
  busy: boolean;
  submitLabel: string;
  onSubmit: (values: DauerbelegValues, file: File | null) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [supplierName, setSupplierName] = useState(initial.supplierName);
  const [supplierUstId, setSupplierUstId] = useState(initial.supplierUstId);
  const [supplierContactId, setSupplierContactId] = useState(initial.supplierContactId);
  /** Getippter Name, wenn der Dialog für einen neuen Lieferanten offen ist; null = geschlossen */
  const [newSupplierName, setNewSupplierName] = useState<string | null>(null);
  const [reference, setReference] = useState(initial.reference);
  const [category, setCategory] = useState(initial.category);
  const [payment, setPayment] = useState(initial.payment);
  const [taxShown, setTaxShown] = useState(initial.taxShown);
  const [note, setNote] = useState(initial.note);
  const [intervalMonths, setIntervalMonths] = useState<RecurringInterval>(initial.intervalMonths);
  const [nextDate, setNextDate] = useState(initial.nextDate);
  const [endDate, setEndDate] = useState(initial.endDate ?? "");
  const [dueDays, setDueDays] = useState(String(initial.dueDays));
  const [amounts, setAmounts] = useState<AmountState[]>(() =>
    initial.amounts.map((a) => ({
      key: nextKey++,
      taxRate: a.taxRate,
      net: a.net ? formatDecimal(a.net) : "",
      tax: a.tax ? formatDecimal(a.tax) : "",
      // Steuer aus dem Netto rechnen, solange sie dazu passt
      taxEdited: a.tax !== taxOf(a.net, a.taxRate),
    })),
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const pickSupplier = (supplier: ContactChoice | null) => {
    setSupplierContactId(supplier?.id ?? null);
    if (!supplier) return;
    setSupplierName(supplier.name);
    setSupplierUstId(supplier.ustId);
  };

  const parsed = amounts.map((a) => {
    const net = parseEuro(a.net);
    const tax = taxShown ? parseEuro(a.tax) : 0;
    return { taxRate: a.taxRate, net: net ?? 0, tax: tax ?? 0, valid: net !== null && net >= 0 && tax !== null && tax >= 0 };
  });
  const sums = dauerbelegSummen(parsed);
  const due = Number(dueDays);
  const usedRates = new Set(amounts.map((a) => a.taxRate));
  const valid =
    name.trim() !== "" &&
    supplierName.trim() !== "" &&
    category !== "" &&
    Boolean(nextDate) &&
    (!endDate || endDate >= nextDate) &&
    Number.isInteger(due) &&
    due >= 0 &&
    due <= 120 &&
    parsed.length > 0 &&
    parsed.every((a) => a.valid) &&
    sums.gross > 0 &&
    usedRates.size === amounts.length;

  function updateAmount(key: number, patch: Partial<AmountState>) {
    setAmounts((prev) =>
      prev.map((a) => {
        if (a.key !== key) return a;
        const next = { ...a, ...patch };
        if (!next.taxEdited) next.tax = formatDecimal(taxOf(parseEuro(next.net), next.taxRate));
        return next;
      }),
    );
  }

  function addRate() {
    const rate = RATES.find((r) => !usedRates.has(r));
    if (rate !== undefined) setAmounts((prev) => [...prev, { key: nextKey++, taxRate: rate, net: "", tax: "", taxEdited: false }]);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    onSubmit(
      {
        name: name.trim(),
        supplierName: supplierName.trim(),
        supplierUstId: supplierUstId.trim(),
        supplierContactId,
        reference: reference.trim(),
        category,
        payment,
        privateShare: initial.privateShare,
        amounts: parsed.map(({ valid: _valid, ...a }) => a),
        taxShown,
        note,
        intervalMonths,
        nextDate,
        endDate: endDate || null,
        dueDays: due,
      },
      fileRef.current?.files?.[0] ?? null,
    );
  }

  return (
    <>
      <form className="card form-card form-narrow" onSubmit={submit} aria-label="Dauerbeleg">
        <section className="form-section" aria-labelledby="dauerbeleg-allgemein">
          <h2 id="dauerbeleg-allgemein">Allgemein</h2>
          <Field label="Bezeichnung">
            {(control) => (
              <input {...control} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder="z. B. Büromiete Hafenstraße" required />
            )}
          </Field>
          <Field label="Aus den Kontakten">
            {(control) => (
              <ContactCombobox
                {...control}
                rolle="lieferant"
                contacts={suppliers}
                contactId={supplierContactId ?? ""}
                onChoose={(id) => pickSupplier(suppliers.find((s) => s.id === id) ?? null)}
                onCreate={setNewSupplierName}
              />
            )}
          </Field>
          <div className="form-row cols-2">
            <Field label="Lieferant">
              {(control) => (
                <input
                  {...control}
                  value={supplierName}
                  onChange={(e) => {
                    setSupplierName(e.target.value);
                    setSupplierContactId(null);
                  }}
                  maxLength={200}
                  placeholder="Vermieter, Versicherung, Leasinggeber"
                  required
                />
              )}
            </Field>
            <Field label="USt-IdNr. des Lieferanten (optional)">
              {(control) => <input {...control} value={supplierUstId} onChange={(e) => setSupplierUstId(e.target.value)} maxLength={20} />}
            </Field>
          </div>
          <div className="form-row cols-2">
            <Field label="Kategorie">
              {(control) => (
                <select {...control} value={category} onChange={(e) => setCategory(e.target.value)} required>
                  <option value="">Bitte wählen</option>
                  {categories.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Bezahlung">
              {(control) => (
                <select {...control} value={payment} onChange={(e) => setPayment(e.target.value as DauerbelegValues["payment"])}>
                  {Object.entries(paymentLabels(rechtsform)).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <Field label="Vertrags- oder Kundennummer (optional)" hint="Steht als Rechnungsnummer an jedem Beleg und hilft im Bankabgleich.">
            {(control) => <input {...control} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />}
          </Field>
        </section>

        <section className="form-section" aria-labelledby="dauerbeleg-termine">
          <h2 id="dauerbeleg-termine">Termine</h2>
          {/* Die Hinweise stehen unter der Zeile, damit beide Felder einer Zeile auf einer Höhe bleiben */}
          <div className="form-row cols-2">
            <Field label={isNew ? "Erster Beleg am" : "Nächster Beleg am"} describedBy="dauer-next-hint">
              {(control) => <input {...control} type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} required />}
            </Field>
            <Field label="Intervall">
              {(control) => (
                <select {...control} value={intervalMonths} onChange={(e) => setIntervalMonths(Number(e.target.value) as RecurringInterval)}>
                  {Object.entries(RECURRING_INTERVALS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <p id="dauer-next-hint" className="field-hint">
            Belegdatum, etwa der Zahlungsbeginn laut Vertrag. Die folgenden Termine liegen am selben Tag im Monat; der 31. wird zum Monatsende. Liegt er in der
            Vergangenheit, legt Haben die verpassten Belege mit ihrem Datum an.
          </p>
          <div className="form-row cols-2">
            <Field label="Fällig Tage nach dem Termin" describedBy="due-hint">
              {(control) => <input {...control} inputMode="numeric" value={dueDays} onChange={(e) => setDueDays(e.target.value)} />}
            </Field>
            <Field label="Endet nach dem (optional)">
              {(control) => (
                <input
                  {...control}
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  aria-invalid={Boolean(endDate) && endDate < nextDate}
                />
              )}
            </Field>
          </div>
          <p id="due-hint" className="field-hint">
            0 = am Termin, etwa 3 für eine Miete bis zum dritten des Monats.
          </p>
        </section>

        <section className="form-section" aria-labelledby="dauerbeleg-dokument">
          <h2 id="dauerbeleg-dokument">Dokument</h2>
          <Field
            label={isNew ? "Vertrag oder Dauerrechnung" : "Neuer Vertrag oder Nachtrag (optional, gilt für künftige Belege)"}
            hint="Der Vertrag ersetzt bei der Miete die monatliche Rechnung (GoBD: keine Buchung ohne Beleg). Jeder Beleg verweist auf diese Datei."
          >
            {(control) => (
              <FilePicker {...control} inputRef={fileRef} accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,.xml" required={isNew} />
            )}
          </Field>
          <label className="checkbox">
            <input type="checkbox" checked={taxShown} onChange={(e) => setTaxShown(e.target.checked)} />
            Das Dokument weist die Umsatzsteuer gesondert aus (Dauerrechnung oder Vertrag mit Steuerbetrag)
          </label>
          {!taxShown && (
            <p className="small banner banner-info" style={{ margin: 0 }}>
              {VORSTEUER_HINWEIS} Wohnraum- und viele Gewerbemieten sind steuerfrei (§ 4 Nr. 12 UStG), Versicherungen ebenso.
            </p>
          )}
          {kleinunternehmer && <p className="field-hint">Als Kleinunternehmer ziehst du keine Vorsteuer ab; Haben bucht den Bruttobetrag als Aufwand.</p>}
        </section>

        <section className="form-section" aria-labelledby="dauerbeleg-betraege">
          <h2 id="dauerbeleg-betraege">Beträge je Termin</h2>
          {amounts.map((a, index) => (
            <div key={a.key} className={taxShown ? "form-row cols-amount" : "form-row cols-amount ohne-steuer"}>
              <Field label={<>Steuersatz {index + 1}</>}>
                {(control) => (
                  <select {...control} value={a.taxRate} onChange={(e) => updateAmount(a.key, { taxRate: Number(e.target.value) as Rate })}>
                    {RATES.filter((r) => r === a.taxRate || !usedRates.has(r)).map((r) => (
                      <option key={r} value={r}>
                        {r / 100} %
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label={<>Netto {index + 1}</>}>
                {(control) => (
                  <input
                    {...control}
                    inputMode="decimal"
                    className="num"
                    value={a.net}
                    onChange={(e) => updateAmount(a.key, { net: e.target.value })}
                    aria-invalid={!parsed[index]!.valid}
                  />
                )}
              </Field>
              {taxShown && (
                <Field label={<>Umsatzsteuer {index + 1}</>}>
                  {(control) => (
                    <input
                      {...control}
                      inputMode="decimal"
                      className="num"
                      value={a.tax}
                      onChange={(e) => updateAmount(a.key, { tax: e.target.value, taxEdited: true })}
                    />
                  )}
                </Field>
              )}
              {amounts.length > 1 && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Steuersatz ${a.taxRate / 100} % entfernen`}
                  onClick={() => setAmounts((prev) => prev.filter((x) => x.key !== a.key))}
                >
                  <Icon name="close" size={16} />
                </button>
              )}
            </div>
          ))}
          {amounts.length < RATES.length && (
            <div>
              <button type="button" className="btn btn-sm" onClick={addRate}>
                <Icon name="plus" size={16} /> Steuersatz hinzufügen
              </button>
            </div>
          )}
          <p className="dauerbeleg-summe">
            Je Termin: {formatEuro(sums.net)} netto{taxShown ? ` + ${formatEuro(sums.tax)} Umsatzsteuer` : ""} = <strong>{formatEuro(sums.gross)}</strong>
          </p>
          <Field label="Notiz an jedem Beleg (optional)">
            {(control) => <textarea {...control} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={2} />}
          </Field>
        </section>

        <div className="actions form-footer">
          <button type="submit" className="btn btn-primary" disabled={busy || !valid}>
            {submitLabel}
          </button>
        </div>
      </form>
      <NewContactDialog
        rolle="lieferant"
        name={newSupplierName}
        prefill={{ name: supplierName, ...(supplierUstId ? { ustId: supplierUstId } : {}) }}
        onSaved={(saved) => pickSupplier(savedAsChoice(saved))}
        onPickExisting={(id) => pickSupplier(suppliers.find((c) => c.id === id) ?? null)}
        onClose={() => setNewSupplierName(null)}
      />
    </>
  );
}

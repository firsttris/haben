import { dauerbelegSummen, formatDecimal, formatEuro, parseEuro, RECURRING_INTERVALS, VORSTEUER_HINWEIS, type RecurringInterval } from "@haben/core";
import { useRef, useState, type FormEvent } from "react";
import { FilePicker } from "./FilePicker.tsx";
import { SupplierPicker, type SupplierOption } from "./SupplierPicker.tsx";

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
const PAYMENT_LABEL = { bank: "Über das Geschäftskonto (Bankabgleich)", privat: "Privat bezahlt (Privateinlage)", kasse: "Bar aus der Kasse" } as const;

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
  isNew,
  busy,
  submitLabel,
  onSubmit,
}: {
  initial: DauerbelegValues;
  suppliers: SupplierOption[];
  categories: { value: string; label: string }[];
  kleinunternehmer: boolean;
  isNew: boolean;
  busy: boolean;
  submitLabel: string;
  onSubmit: (values: DauerbelegValues, file: File | null) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [supplierName, setSupplierName] = useState(initial.supplierName);
  const [supplierUstId, setSupplierUstId] = useState(initial.supplierUstId);
  const [supplierContactId, setSupplierContactId] = useState(initial.supplierContactId);
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
    <form className="stack" onSubmit={submit}>
      <section className="card stack" aria-label="Dauerbeleg">
        <div className="form-grid">
          <label className="field">
            Bezeichnung
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder="z. B. Büromiete Hafenstraße" required />
          </label>
          <SupplierPicker
            suppliers={suppliers}
            value={supplierContactId}
            onPick={(supplier) => {
              setSupplierContactId(supplier?.id ?? null);
              if (supplier) {
                setSupplierName(supplier.name);
                setSupplierUstId(supplier.ustId);
              }
            }}
          />
          <label className="field">
            Lieferant
            <input
              value={supplierName}
              onChange={(e) => {
                setSupplierName(e.target.value);
                setSupplierContactId(null);
              }}
              maxLength={200}
              placeholder="Vermieter, Versicherung, Leasinggeber"
              required
            />
          </label>
          <label className="field">
            USt-IdNr. des Lieferanten (optional)
            <input value={supplierUstId} onChange={(e) => setSupplierUstId(e.target.value)} maxLength={20} />
          </label>
          <label className="field">
            Vertrags- oder Kundennummer (optional)
            <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} aria-describedby="reference-hint" />
            <span id="reference-hint" className="small">
              Steht als Rechnungsnummer an jedem Beleg und hilft im Bankabgleich.
            </span>
          </label>
          <label className="field">
            Kategorie
            <select value={category} onChange={(e) => setCategory(e.target.value)} required>
              <option value="">Bitte wählen</option>
              {categories.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Bezahlung
            <select value={payment} onChange={(e) => setPayment(e.target.value as DauerbelegValues["payment"])}>
              {Object.entries(PAYMENT_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="card stack" aria-labelledby="dauerbeleg-termine">
        <h2 id="dauerbeleg-termine">Termine</h2>
        <div className="form-grid">
          <label className="field">
            Intervall
            <select value={intervalMonths} onChange={(e) => setIntervalMonths(Number(e.target.value) as RecurringInterval)}>
              {Object.entries(RECURRING_INTERVALS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {isNew ? "Erster Beleg am" : "Nächster Beleg am"}
            <input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} required aria-describedby="dauer-next-hint" />
            <span id="dauer-next-hint" className="small">
              Belegdatum, etwa der Zahlungsbeginn laut Vertrag. Die folgenden Termine liegen am selben Tag im Monat; der 31. wird zum Monatsende. Liegt er in
              der Vergangenheit, legt Haben die verpassten Belege mit ihrem Datum an.
            </span>
          </label>
          <label className="field">
            Endet nach dem (optional)
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} aria-invalid={Boolean(endDate) && endDate < nextDate} />
          </label>
          <label className="field">
            Fällig Tage nach dem Termin
            <input inputMode="numeric" value={dueDays} onChange={(e) => setDueDays(e.target.value)} aria-describedby="due-hint" />
            <span id="due-hint" className="small">
              0 = am Termin, etwa 3 für eine Miete bis zum dritten des Monats.
            </span>
          </label>
        </div>
      </section>

      <section className="card stack" aria-labelledby="dauerbeleg-dokument">
        <h2 id="dauerbeleg-dokument">Vertrag und Beträge</h2>
        <label className="field">
          {isNew ? "Vertrag oder Dauerrechnung" : "Neuer Vertrag oder Nachtrag (optional, gilt für künftige Belege)"}
          <FilePicker inputRef={fileRef} accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,.xml" required={isNew} />
          <span className="small">
            Der Vertrag ersetzt bei der Miete die monatliche Rechnung (GoBD: keine Buchung ohne Beleg). Jeder Beleg verweist auf diese Datei.
          </span>
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={taxShown} onChange={(e) => setTaxShown(e.target.checked)} />
          Das Dokument weist die Umsatzsteuer gesondert aus (Dauerrechnung oder Vertrag mit Steuerbetrag)
        </label>
        {!taxShown && (
          <p className="small banner banner-info" style={{ margin: 0 }}>
            {VORSTEUER_HINWEIS} Wohnraum- und viele Gewerbemieten sind steuerfrei (§ 4 Nr. 12 UStG), Versicherungen ebenso.
          </p>
        )}
        {kleinunternehmer && (
          <p className="small muted" style={{ margin: 0 }}>
            Als Kleinunternehmer ziehst du keine Vorsteuer ab; Haben bucht den Bruttobetrag als Aufwand.
          </p>
        )}
        <div className="stack" style={{ gap: 8 }}>
          {amounts.map((a, index) => (
            <div key={a.key} className="form-grid" style={{ alignItems: "end" }}>
              <label className="field">
                Steuersatz {index + 1}
                <select value={a.taxRate} onChange={(e) => updateAmount(a.key, { taxRate: Number(e.target.value) as Rate })}>
                  {RATES.filter((r) => r === a.taxRate || !usedRates.has(r)).map((r) => (
                    <option key={r} value={r}>
                      {r / 100} %
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Netto {index + 1}
                <input inputMode="decimal" value={a.net} onChange={(e) => updateAmount(a.key, { net: e.target.value })} aria-invalid={!parsed[index]!.valid} />
              </label>
              {taxShown && (
                <label className="field">
                  Umsatzsteuer {index + 1}
                  <input inputMode="decimal" value={a.tax} onChange={(e) => updateAmount(a.key, { tax: e.target.value, taxEdited: true })} />
                </label>
              )}
              {amounts.length > 1 && (
                <button type="button" className="btn btn-sm" onClick={() => setAmounts((prev) => prev.filter((x) => x.key !== a.key))}>
                  Steuersatz {a.taxRate / 100} % entfernen
                </button>
              )}
            </div>
          ))}
          {amounts.length < RATES.length && (
            <div>
              <button type="button" className="btn btn-sm" onClick={addRate}>
                + Steuersatz
              </button>
            </div>
          )}
        </div>
        <p style={{ margin: 0 }}>
          Je Termin: {formatEuro(sums.net)} netto{taxShown ? ` + ${formatEuro(sums.tax)} Umsatzsteuer` : ""} = <strong>{formatEuro(sums.gross)}</strong>
        </p>
        <label className="field">
          Notiz an jedem Beleg (optional)
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={2} />
        </label>
      </section>

      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !valid}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

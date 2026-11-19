import { formatEuro, ownerLabels, RECURRING_INTERVALS, type RecurringInterval, type Rechtsform, VORSTEUER_HINWEIS } from "@haben/core";
import type { RefObject } from "react";
import type { Betragszeile } from "../lib/betragszeile.ts";
import { CategoryCombobox } from "./CategoryCombobox.tsx";
import { ContactCombobox, type ContactChoice } from "./ContactCombobox.tsx";
import type { DauerbelegValues } from "./DauerbelegForm.tsx";
import { Field } from "./Field.tsx";
import { FilePicker } from "./FilePicker.tsx";
import { Icon } from "./Icon.tsx";

/* Abschnitte des Formulars für einen Dauerbeleg (DauerbelegForm.tsx) */

export type Rate = 1900 | 700 | 0;
export const RATES: Rate[] = [1900, 700, 0];

/** Bearbeitbarer Stand ohne Beträge; Fälligkeit und Ende als Text */
export type DauerbelegState = Omit<DauerbelegValues, "amounts" | "taxShown" | "privateShare" | "endDate" | "dueDays"> & { endDate: string; dueDays: string };

type Fehler = (key: string) => string | undefined;
type TeilProps = { v: DauerbelegState; set: (patch: Partial<DauerbelegState>) => void; error: Fehler };

/** Aus eigenem Geld bezahlt heißt je nach Rechtsform Privateinlage oder Verrechnungskonto des Gesellschafters */
const paymentLabels = (rechtsform: Rechtsform) =>
  ({ bank: "Über das Geschäftskonto (Bankabgleich)", privat: ownerLabels(rechtsform).documentPaid, kasse: "Bar aus der Kasse" }) as const;

export function DauerbelegAllgemein({
  v,
  set,
  error,
  suppliers,
  categories,
  rechtsform,
  pickSupplier,
  onCreateSupplier,
}: TeilProps & {
  suppliers: ContactChoice[];
  categories: { value: string; label: string }[];
  rechtsform: Rechtsform;
  pickSupplier: (supplier: ContactChoice | null) => void;
  onCreateSupplier: (name: string) => void;
}) {
  return (
    <section className="form-section" aria-labelledby="dauerbeleg-allgemein">
      <h2 id="dauerbeleg-allgemein">Allgemein</h2>
      <Field label="Bezeichnung" error={error("name")}>
        {(control) => (
          <input
            {...control}
            value={v.name}
            onChange={(e) => set({ name: e.target.value })}
            maxLength={200}
            placeholder="z. B. Büromiete Hafenstraße"
            required
          />
        )}
      </Field>
      <Field label="Aus den Kontakten">
        {(control) => (
          <ContactCombobox
            {...control}
            rolle="lieferant"
            contacts={suppliers}
            contactId={v.supplierContactId ?? ""}
            onChoose={(id) => pickSupplier(suppliers.find((s) => s.id === id) ?? null)}
            onCreate={onCreateSupplier}
          />
        )}
      </Field>
      <div className="form-row cols-2">
        <Field label="Lieferant" error={error("supplier")}>
          {(control) => (
            <input
              {...control}
              value={v.supplierName}
              onChange={(e) => set({ supplierName: e.target.value, supplierContactId: null })}
              maxLength={200}
              placeholder="Vermieter, Versicherung, Leasinggeber"
              required
            />
          )}
        </Field>
        <Field label="USt-IdNr. des Lieferanten (optional)">
          {(control) => <input {...control} value={v.supplierUstId} onChange={(e) => set({ supplierUstId: e.target.value })} maxLength={20} />}
        </Field>
      </div>
      <div className="form-row cols-2">
        <Field label="Kategorie" error={error("category")}>
          {(control) => <CategoryCombobox {...control} categories={categories} value={v.category} onChoose={(category) => set({ category })} required />}
        </Field>
        <Field label="Bezahlung">
          {(control) => (
            <select {...control} value={v.payment} onChange={(e) => set({ payment: e.target.value as DauerbelegValues["payment"] })}>
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
        {(control) => <input {...control} value={v.reference} onChange={(e) => set({ reference: e.target.value })} maxLength={100} />}
      </Field>
    </section>
  );
}

export function DauerbelegTermine({ v, set, error, isNew }: TeilProps & { isNew: boolean }) {
  return (
    <section className="form-section" aria-labelledby="dauerbeleg-termine">
      <h2 id="dauerbeleg-termine">Termine</h2>
      {/* Die Hinweise stehen unter der Zeile, damit beide Felder einer Zeile auf einer Höhe bleiben */}
      <div className="form-row cols-2">
        <Field label={isNew ? "Erster Beleg am" : "Nächster Beleg am"} describedBy="dauer-next-hint" error={error("nextDate")}>
          {(control) => <input {...control} type="date" value={v.nextDate} onChange={(e) => set({ nextDate: e.target.value })} required />}
        </Field>
        <Field label="Intervall">
          {(control) => (
            <select {...control} value={v.intervalMonths} onChange={(e) => set({ intervalMonths: Number(e.target.value) as RecurringInterval })}>
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
        <Field label="Fällig Tage nach dem Termin" describedBy="due-hint" error={error("due")}>
          {(control) => <input {...control} inputMode="numeric" value={v.dueDays} onChange={(e) => set({ dueDays: e.target.value })} />}
        </Field>
        <Field label="Endet nach dem (optional)" error={error("endDate")}>
          {(control) => <input {...control} type="date" value={v.endDate} onChange={(e) => set({ endDate: e.target.value })} />}
        </Field>
      </div>
      <p id="due-hint" className="field-hint">
        0 = am Termin, etwa 3 für eine Miete bis zum dritten des Monats.
      </p>
    </section>
  );
}

export function DauerbelegDokument(props: {
  error: Fehler;
  isNew: boolean;
  withoutFile: boolean;
  fileRef: RefObject<HTMLInputElement | null>;
  setHasFile: (has: boolean) => void;
  taxShown: boolean;
  chooseTaxShown: (an: boolean) => void;
  kleinunternehmer: boolean;
}) {
  const { error, isNew, withoutFile, fileRef, setHasFile, taxShown, chooseTaxShown, kleinunternehmer } = props;
  return (
    <section className="form-section" aria-labelledby="dauerbeleg-dokument">
      <h2 id="dauerbeleg-dokument">Dokument</h2>
      <Field
        label={
          isNew
            ? "Vertrag oder Dauerrechnung"
            : withoutFile
              ? "Vertrag oder Dauerrechnung (vor dem Fortsetzen nötig)"
              : "Neuer Vertrag oder Nachtrag (optional, gilt für künftige Belege)"
        }
        hint="Der Vertrag ersetzt bei der Miete die monatliche Rechnung (GoBD: keine Buchung ohne Beleg). Jeder Beleg verweist auf diese Datei."
        error={error("file")}
      >
        {(control) => (
          <FilePicker
            {...control}
            inputRef={fileRef}
            accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,.xml"
            required={isNew}
            onChange={(e) => setHasFile((e.target.files?.length ?? 0) > 0)}
          />
        )}
      </Field>
      <label className="checkbox">
        <input type="checkbox" checked={taxShown} onChange={(e) => chooseTaxShown(e.target.checked)} />
        Das Dokument weist die Umsatzsteuer gesondert aus (Dauerrechnung oder Vertrag mit Steuerbetrag)
      </label>
      {!taxShown && (
        <p className="small banner banner-info" style={{ margin: 0 }}>
          {VORSTEUER_HINWEIS} Wohnraum- und viele Gewerbemieten sind steuerfrei (§ 4 Nr. 12 UStG), Versicherungen ebenso.
        </p>
      )}
      {kleinunternehmer && <p className="field-hint">Als Kleinunternehmer ziehst du keine Vorsteuer ab; Haben bucht den Bruttobetrag als Aufwand.</p>}
    </section>
  );
}

export function DauerbelegBetraege(props: {
  v: DauerbelegState;
  set: (patch: Partial<DauerbelegState>) => void;
  error: Fehler;
  amounts: Betragszeile[];
  taxShown: boolean;
  sums: { net: number; tax: number; gross: number };
  updateAmount: (key: number, patch: Partial<Omit<Betragszeile, "key">>) => void;
  removeAmount: (key: number) => void;
  addRate: () => void;
}) {
  const { v, set, error, amounts, taxShown, sums, updateAmount, addRate } = props;
  const usedRates = new Set(amounts.map((a) => a.taxRate));
  return (
    <section className="form-section" aria-labelledby="dauerbeleg-betraege">
      <h2 id="dauerbeleg-betraege">Beträge je Termin</h2>
      {amounts.map((a, index) => (
        <div key={a.key} className={taxShown ? "form-row cols-amount mit-brutto" : "form-row cols-amount ohne-steuer"}>
          <Field label={<>Steuersatz {index + 1}</>} error={error(`satz-${a.key}`)}>
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
          <Field label={<>Netto {index + 1}</>} error={error(`netto-${a.key}`) ?? (index === amounts.length - 1 ? error("summe") : undefined)}>
            {(control) => (
              <input {...control} inputMode="decimal" className="num" value={a.net} onChange={(e) => updateAmount(a.key, { net: e.target.value })} />
            )}
          </Field>
          {taxShown && (
            <Field label={<>Umsatzsteuer {index + 1}</>} error={error(`steuer-${a.key}`)}>
              {(control) => (
                <input
                  {...control}
                  inputMode="decimal"
                  className="num"
                  value={a.tax}
                  onChange={(e) => updateAmount(a.key, { tax: e.target.value, taxTouched: true })}
                />
              )}
            </Field>
          )}
          {taxShown && (
            <Field label={<>Brutto {index + 1}</>} error={error(`brutto-${a.key}`)}>
              {(control) => (
                <input {...control} inputMode="decimal" className="num" value={a.gross} onChange={(e) => updateAmount(a.key, { gross: e.target.value })} />
              )}
            </Field>
          )}
          {amounts.length > 1 && (
            <button type="button" className="icon-btn" aria-label={`Steuersatz ${a.taxRate / 100} % entfernen`} onClick={() => props.removeAmount(a.key)}>
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
        {(control) => <textarea {...control} value={v.note} onChange={(e) => set({ note: e.target.value })} maxLength={2000} rows={2} />}
      </Field>
    </section>
  );
}

import { amountError, dauerbelegSummen, parseEuro, type RecurringInterval, type Rechtsform, type Prozent } from "@haben/core";
import { useRef, useState, type FormEvent } from "react";
import { savedAsChoice, type ContactChoice } from "./ContactCombobox.tsx";
import { NewContactDialog } from "./NewContactDialog.tsx";
import { aendereBetragszeile, betragszeileAus, betragszeileAusVorlage, bruttoLesbar, steuerausweisUmschalten, type Betragszeile } from "../lib/betragszeile.ts";
import { useSubmitCheck } from "../lib/use-submit-check.ts";
import { DauerbelegAllgemein, DauerbelegBetraege, DauerbelegDokument, type DauerbelegState, DauerbelegTermine, RATES, type Rate } from "./DauerbelegTeile.tsx";

export interface DauerbelegValues {
  name: string;
  supplierName: string;
  supplierUstId: string;
  supplierContactId: string | null;
  reference: string;
  category: string;
  payment: "bank" | "privat" | "kasse";
  privateShare: Prozent;
  amounts: { taxRate: Rate; net: number; tax: number }[];
  taxShown: boolean;
  note: string;
  intervalMonths: RecurringInterval;
  nextDate: string;
  endDate: string | null;
  dueDays: number;
}

let nextKey = 1;

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
  withoutFile = false,
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
  /** Übernommene Vorlage ohne Datei: Die Datei ist vor dem Fortsetzen nötig */
  withoutFile?: boolean;
  busy: boolean;
  submitLabel: string;
  onSubmit: (values: DauerbelegValues, file: File | null) => void;
}) {
  const [v, setV] = useState<DauerbelegState>(() => dauerbelegState(initial));
  const set = (patch: Partial<DauerbelegState>) => setV((prev) => ({ ...prev, ...patch }));
  /** Getippter Name, wenn der Dialog für einen neuen Lieferanten offen ist; null = geschlossen */
  const [newSupplierName, setNewSupplierName] = useState<string | null>(null);
  const [taxShown, setTaxShown] = useState(initial.taxShown);
  const [amounts, setAmounts] = useState<Betragszeile[]>(() => initial.amounts.map((a) => betragszeileAusVorlage(nextKey++, a, initial.taxShown)));
  const fileRef = useRef<HTMLInputElement>(null);
  // Ob eine Datei gewählt ist, für die Prüfung beim Speichern; die Datei selbst liest submit aus fileRef
  const [hasFile, setHasFile] = useState(false);
  const pickSupplier = (supplier: ContactChoice | null) =>
    set(supplier ? { supplierContactId: supplier.id, supplierName: supplier.name, supplierUstId: supplier.ustId } : { supplierContactId: null });

  const parsed = amounts.map((a) => {
    const net = parseEuro(a.net);
    const tax = taxShown ? parseEuro(a.tax) : 0;
    return { taxRate: a.taxRate, net: net ?? 0, tax: tax ?? 0, valid: net !== null && net >= 0 && tax !== null && tax >= 0 };
  });
  const sums = dauerbelegSummen(parsed);
  const { form, error, check } = useSubmitCheck(dauerbelegErrors(v, amounts, taxShown, parsed, sums.gross, isNew && !hasFile));

  // Selbst geschuldete Steuer (§ 13b) gibt es am Dauerbeleg nicht
  function updateAmount(key: number, patch: Partial<Omit<Betragszeile, "key">>) {
    setAmounts((prev) => prev.map((a) => (a.key === key ? aendereBetragszeile(a, patch, false) : a)));
  }

  function chooseTaxShown(an: boolean) {
    setTaxShown(an);
    setAmounts((prev) => steuerausweisUmschalten(prev, an));
  }

  function addRate() {
    const used = new Set(amounts.map((a) => a.taxRate));
    const rate = RATES.find((r) => !used.has(r));
    if (rate !== undefined) setAmounts((prev) => [...prev, betragszeileAus(nextKey++, rate, 0, 0, true, false)]);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!check()) return;
    const values: DauerbelegValues = {
      ...v,
      name: v.name.trim(),
      supplierName: v.supplierName.trim(),
      supplierUstId: v.supplierUstId.trim(),
      reference: v.reference.trim(),
      privateShare: initial.privateShare,
      amounts: parsed.map(({ valid: _valid, ...a }) => a),
      taxShown,
      endDate: v.endDate || null,
      dueDays: Number(v.dueDays),
    };
    onSubmit(values, fileRef.current?.files?.[0] ?? null);
  }

  return (
    <>
      <form ref={form} className="card form-card form-narrow" onSubmit={submit} aria-label="Dauerbeleg" noValidate>
        <DauerbelegAllgemein
          v={v}
          set={set}
          error={error}
          suppliers={suppliers}
          categories={categories}
          rechtsform={rechtsform}
          pickSupplier={pickSupplier}
          onCreateSupplier={setNewSupplierName}
        />
        <DauerbelegTermine v={v} set={set} error={error} isNew={isNew} />
        <DauerbelegDokument
          error={error}
          isNew={isNew}
          withoutFile={withoutFile}
          fileRef={fileRef}
          setHasFile={setHasFile}
          taxShown={taxShown}
          chooseTaxShown={chooseTaxShown}
          kleinunternehmer={kleinunternehmer}
        />
        <DauerbelegBetraege
          v={v}
          set={set}
          error={error}
          amounts={amounts}
          taxShown={taxShown}
          sums={sums}
          updateAmount={updateAmount}
          removeAmount={(key) => setAmounts((prev) => prev.filter((x) => x.key !== key))}
          addRate={addRate}
        />
        <div className="actions form-footer">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {submitLabel}
          </button>
        </div>
      </form>
      <NewContactDialog
        rolle="lieferant"
        name={newSupplierName}
        prefill={{ name: v.supplierName, ...(v.supplierUstId ? { ustId: v.supplierUstId } : {}) }}
        onSaved={(saved) => pickSupplier(savedAsChoice(saved))}
        onPickExisting={(id) => pickSupplier(suppliers.find((c) => c.id === id) ?? null)}
        onClose={() => setNewSupplierName(null)}
      />
    </>
  );
}

function dauerbelegState({ amounts: _amounts, taxShown: _taxShown, privateShare: _privateShare, ...values }: DauerbelegValues): DauerbelegState {
  return { ...values, endDate: values.endDate ?? "", dueDays: String(values.dueDays) };
}

/** Fehler je Feld für die Prüfung beim Speichern; null, wo alles stimmt */
function dauerbelegErrors(
  v: DauerbelegState,
  amounts: Betragszeile[],
  taxShown: boolean,
  parsed: { valid: boolean }[],
  gross: number,
  fileMissing: boolean,
): Record<string, string | null> {
  const BETRAG = amountError("den Betrag", 85_000);
  const due = Number(v.dueDays);
  return {
    ...Object.fromEntries(
      amounts.flatMap((a, i) => [
        [`netto-${a.key}`, parseEuro(a.net) === null || parseEuro(a.net)! < 0 ? BETRAG : null],
        [`steuer-${a.key}`, taxShown && (parseEuro(a.tax) === null || parseEuro(a.tax)! < 0) ? BETRAG : null],
        // Ein vertipptes Brutto lässt die vorigen Beträge stehen; gespeichert würde dann etwas anderes als eingegeben
        [`brutto-${a.key}`, taxShown && !bruttoLesbar(a) ? BETRAG : null],
        [`satz-${a.key}`, amounts.findIndex((x) => x.taxRate === a.taxRate) < i ? "Diesen Satz gibt es schon in einer Zeile darüber." : null],
      ]),
    ),
    summe: parsed.every((a) => a.valid) && gross <= 0 ? "Der Betrag je Termin muss über 0 liegen." : null,
    name: v.name.trim() === "" ? "Trag eine Bezeichnung ein, etwa Büromiete Hafenstraße." : null,
    supplier: v.supplierName.trim() === "" ? "Trag den Lieferanten ein." : null,
    category: v.category === "" ? "Wähle die Kategorie." : null,
    nextDate: v.nextDate ? null : "Wähle den Tag des ersten Belegs.",
    endDate: v.endDate && v.endDate < v.nextDate ? "Wähle einen Tag ab dem ersten Beleg." : null,
    due: Number.isInteger(due) && due >= 0 && due <= 120 ? null : "Trag ganze Tage von 0 bis 120 ein.",
    file: fileMissing ? "Wähle den Vertrag oder die Dauerrechnung." : null,
  };
}

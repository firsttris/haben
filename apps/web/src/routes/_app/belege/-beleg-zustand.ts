import type { ExpenseCategory, SelfAssessedTax } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, type FormEvent } from "react";
import { flushSync } from "react-dom";
import type { ContactChoice } from "../../../components/ContactCombobox.tsx";
import { splitRow } from "../../../components/DocumentSplits.tsx";
import { inWeitereAngaben, isEuVatId } from "../../../components/WeitereAngaben.tsx";
import { aendereBetragszeile } from "../../../lib/betragszeile.ts";
import { fehlerFelder } from "../../../lib/format.ts";
import { useAction } from "../../../lib/use-action.ts";
import { useSubmitCheck } from "../../../lib/use-submit-check.ts";
import { saveDocument } from "../../../server/functions/documents.ts";
import { type DocumentFields, useDocumentFields, useDocumentRows } from "./-beleg-felder.ts";
import { documentFieldErrors, documentFigures, documentInput } from "./-beleg-pruefung.ts";
import type { Detail } from "./-beleg-vorschau.tsx";
import type { AmountState } from "./-beleg-zeile.ts";

/** Zustand, Prüfung und Speichern des Belegformulars; Buchen, Löschen und die Knöpfe stehen in DocumentForm */
export function useDocumentForm({ data, inhaber, onDirtyChange }: { data: Detail; inhaber: boolean; onDirtyChange: (dirty: boolean) => void }) {
  const { document: doc, ownAccounts, issues } = data;
  const router = useRouter();
  const save = useServerFn(saveDocument);
  const locked = doc.status === "gebucht";
  // Die Steuerberatung sieht den Beleg wie einen gebuchten: alle Felder gesperrt, keine Knöpfe
  const readOnly = locked || !inhaber;
  const running = doc.extractionStatus === "laeuft";
  // Alte Entwürfe können noch manuell eingegebene Steuer enthalten; festgeschriebene Beträge bleiben unverändert.
  const calculateInitialTax = !readOnly && !running && Boolean(doc.reverseCharge);

  const fields = useDocumentFields(doc, issues);
  const rowState = useDocumentRows(data, calculateInitialTax);
  const { rows, splitRows, splitting, dirty, setDirty } = rowState;
  const { busy, notice, run } = useAction();

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const figures = documentFigures(fields, rows, splitRows, data, locked);
  const { form, error, pruefen, mitFeldfehlern } = useFieldCheck(documentFieldErrors(fields, rows, splitRows, figures), fields.setWeitereOffen);
  const actions = documentActions(fields, rowState, data.suppliers);

  async function persist() {
    await save({ data: { id: doc.id, document: documentInput(fields, figures, splitting, ownAccounts) } });
    setDirty(false);
  }

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    if (!pruefen()) return;
    void run(() =>
      mitFeldfehlern(async () => {
        await persist();
        await router.invalidate({ sync: true });
      }),
    );
  };

  return {
    locked,
    readOnly,
    running,
    ...fields,
    ...rowState,
    busy,
    notice,
    run,
    ...figures,
    form,
    error,
    pruefen,
    mitFeldfehlern,
    ...actions,
    persist,
    onSave,
  };
}

export type DocumentFormState = ReturnType<typeof useDocumentForm>;

/** Prüfung vor dem Absenden; ein Fehler in „Weitere Angaben“ klappt den Bereich auf */
function useFieldCheck(fehler: Record<string, string | null>, setWeitereOffen: (open: boolean) => void) {
  const { form, error, check } = useSubmitCheck(fehler);
  // Fehler in „Weitere Angaben“ klappen den Bereich auf, bevor der Fokus das Feld sucht: Im zugeklappten
  // Bereich fände er es nicht, und die Meldung bliebe unsichtbar
  const pruefen = () => {
    if (Object.entries(fehler).some(([feld, text]) => text && inWeitereAngaben(feld))) flushSync(() => setWeitereOffen(true));
    return check();
  };
  // Ebenso, wenn der Server beim Speichern oder Buchen einen Fehler an einem Feld darin meldet
  const mitFeldfehlern = async (work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      if (fehlerFelder(error).some(inWeitereAngaben)) setWeitereOffen(true);
      throw error;
    }
  };
  return { form, error, pruefen, mitFeldfehlern };
}

/** Änderungen am Formular, die mehrere Felder betreffen oder es als geändert markieren */
function documentActions(fields: DocumentFields, rowState: ReturnType<typeof useDocumentRows>, suppliers: Detail["suppliers"]) {
  const { supplierUstId, supplierContactId, setSupplierContactId, setSupplierName, setWeitereOffen, reverseCharge } = fields;
  const { rows, setRows, setDirty } = rowState;

  function touch<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setDirty(true);
    };
  }

  function chooseReverseCharge(value: SelfAssessedTax | null) {
    touch(fields.setReverseCharge)(value);
    // Der Erwerb braucht die USt-IdNr. des Lieferanten aus der EU: dann liegt das Feld offen
    if (value === "ig_erwerb" && !isEuVatId(supplierUstId)) setWeitereOffen(true);
    // Die Steuer steht nicht auf der Rechnung; Haben rechnet sie aus dem Netto, 0 % gibt es bei § 13b und beim Erwerb nicht
    // Gezahlt wird das Netto; ein vorher eingegebenes Brutto ist keine Grundlage mehr
    if (value) {
      setRows((prev) =>
        prev.map((row) => ({
          ...aendereBetragszeile(row, { taxRate: row.taxRate === 0 ? 1900 : row.taxRate, taxTouched: false, basis: "net" }, true),
          vorsteuerAnteil: row.vorsteuerAnteil,
        })),
      );
    }
  }

  /** Aufteilen: je Betragszeile eine Zeile mit der bisherigen Kategorie, dazu eine leere zum Verteilen */
  function startSplitting() {
    const first = fields.category === "anlage" ? "" : (fields.category as ExpenseCategory | "");
    const fromAmounts = rows.map((row, i) => splitRow(i === 0 ? first : "", row.taxRate, row.net, i === 0 ? fields.ownAccountId : ""));
    touch(rowState.setSplitRows)([...fromAmounts, splitRow("", rows[0]?.taxRate ?? 1900, "")]);
  }

  function updateRow(key: number, patch: Partial<Omit<AmountState, "key">>) {
    setRows((prev) =>
      prev.map((row) =>
        row.key === key ? { ...aendereBetragszeile(row, patch, Boolean(reverseCharge)), vorsteuerAnteil: patch.vorsteuerAnteil ?? row.vorsteuerAnteil } : row,
      ),
    );
    setDirty(true);
  }

  /** Gewählter Kontakt: Name und USt-IdNr. übernehmen; „frei eingetragen“ lässt die Felder stehen */
  function pickSupplier(supplier: ContactChoice | null) {
    setSupplierContactId(supplier?.id ?? null);
    if (!supplier) return;
    setSupplierName(supplier.name);
    fields.setSupplierUstId(supplier.ustId);
  }

  /** Wer den Namen von Hand ändert, meint einen anderen Lieferanten: die Verknüpfung fällt weg */
  function typeSupplierName(name: string) {
    setSupplierName(name);
    if (supplierContactId && suppliers.find((s) => s.id === supplierContactId)?.name !== name) setSupplierContactId(null);
  }

  return { touch, chooseReverseCharge, startSplitting, updateRow, pickSupplier, typeSupplierName };
}

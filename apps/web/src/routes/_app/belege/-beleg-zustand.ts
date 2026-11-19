import {
  amountError,
  convertForeignAmounts,
  CURRENCY_CODE,
  formatDecimal,
  formatExchangeRate,
  parseEuro,
  parseExchangeRate,
  taxOf,
  type AssetKind,
  type AssetMethod,
  usesUsefulLife,
  type ExpenseCategory,
  type SelfAssessedTax,
} from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { parseSplitRows, splitRow, type SplitRowState } from "../../../components/DocumentSplits.tsx";
import { passendesKonto } from "../../../components/EigenesKontoWahl.tsx";
import type { ContactChoice } from "../../../components/ContactCombobox.tsx";
import { fehlerFelder, parseUsefulLifeMonths } from "../../../lib/format.ts";
import { useAction } from "../../../lib/use-action.ts";
import { aendereBetragszeile, betragszeileGespeichert, bruttoLesbar, type Betragszeile, type BetragsSatz } from "../../../lib/betragszeile.ts";
import { PRIVATANTEIL_FEHLER, parsePrivatanteil } from "../../../lib/anteil.ts";
import { useSubmitCheck } from "../../../lib/use-submit-check.ts";
import { saveDocument } from "../../../server/functions/documents.ts";
import { formatVorsteuerAnteil, parseVorsteuerAnteil } from "../../../components/VorsteuerAnteil.tsx";
import { inWeitereAngaben, isEuVatId, leistungsendeFehler } from "../../../components/WeitereAngaben.tsx";
import type { Detail } from "./-beleg-vorschau.tsx";

export type Rate = BetragsSatz;

export interface AmountState extends Betragszeile {
  vorsteuerAnteil: string;
}

let nextKey = 1;

/** Schlüssel für eine neue Betragszeile */
export function nextRowKey() {
  return nextKey++;
}

/** Zustand, Prüfung und Speichern des Belegformulars; Buchen, Löschen und die Knöpfe stehen in DocumentForm */
export function useDocumentForm({ data, inhaber, onDirtyChange }: { data: Detail; inhaber: boolean; onDirtyChange: (dirty: boolean) => void }) {
  const { document: doc, amounts, splits, ownAccounts, issues } = data;
  const router = useRouter();
  const save = useServerFn(saveDocument);
  const locked = doc.status === "gebucht";
  // Die Steuerberatung sieht den Beleg wie einen gebuchten: alle Felder gesperrt, keine Knöpfe
  const readOnly = locked || !inhaber;
  const running = doc.extractionStatus === "laeuft";
  // Alte Entwürfe können noch manuell eingegebene Steuer enthalten; festgeschriebene Beträge bleiben unverändert.
  const calculateInitialTax = !readOnly && !running && Boolean(doc.reverseCharge);

  const [supplierName, setSupplierName] = useState(doc.supplierName);
  const [supplierUstId, setSupplierUstId] = useState(doc.supplierUstId);
  const [supplierContactId, setSupplierContactId] = useState<string | null>(doc.supplierContactId);
  /** Getippter Name, wenn der Dialog für einen neuen Lieferanten offen ist; null = geschlossen */
  const [newSupplierName, setNewSupplierName] = useState<string | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState(doc.invoiceNumber);
  const [documentDate, setDocumentDate] = useState(doc.documentDate ?? "");
  const [dueDate, setDueDate] = useState(doc.dueDate ?? "");
  // Leistungszeitraum (#693): worauf sich die Leistung bezieht, nicht wann die Rechnung kam
  const [serviceFrom, setServiceFrom] = useState(doc.serviceFrom ?? "");
  const [serviceTo, setServiceTo] = useState(doc.serviceTo ?? "");
  const [category, setCategory] = useState(doc.category ?? "");
  // Eigenes Sachkonto statt des Kontos der Kategorie (#270); leer = das Konto der Kategorie
  const [ownAccountId, setOwnAccountId] = useState(doc.ownAccountId ?? "");
  const [payment, setPayment] = useState(doc.payment);
  const [privateShare, setPrivateShare] = useState(doc.privateShare ? String(doc.privateShare) : "");
  // Leer = Firmenvorgabe, sonst wirtschaftlich zugeordneter Anteil mit bis zu zwei Nachkommastellen.
  const [vorsteuerAnteil, setVorsteuerAnteil] = useState(formatVorsteuerAnteil(doc.vorsteuerAnteil));
  // Gutschrift erstattet bereits Bezahltes (#786): die Vorsteuerminderung wartet auf den Ausgleich
  const [erstattetBezahltes, setErstattetBezahltes] = useState(doc.erstattetBezahltes);
  // Angaben zur Anlage bei Kategorie „anlage“; Vorschläge laut AfA-Tabelle
  const [assetName, setAssetName] = useState(doc.asset?.name ?? "");
  const [assetKind, setAssetKind] = useState<AssetKind>(doc.asset?.kind ?? "edv");
  const [assetMethod, setAssetMethod] = useState<AssetMethod>(doc.asset?.method ?? "digital");
  const [assetYears, setAssetYears] = useState(doc.asset?.usefulLifeMonths ? String(doc.asset.usefulLifeMonths / 12) : "");
  const [note, setNote] = useState(doc.note);
  const [reverseCharge, setReverseCharge] = useState<SelfAssessedTax | null>(doc.reverseCharge ?? null);
  const [currency, setCurrency] = useState(doc.currency);
  const [exchangeRate, setExchangeRate] = useState(doc.exchangeRate ? formatExchangeRate(doc.exchangeRate) : "");
  const [exchangeRateDate, setExchangeRateDate] = useState(doc.exchangeRateSource === "ust" ? "" : (doc.exchangeRateDate ?? ""));
  // „Weitere Angaben“ stehen offen, wo sie gebraucht werden: bei Fremdwährung (Kurs) und wenn ein Hinweis „Vor dem Buchen“ an
  // einem Feld darin liegt, etwa an der USt-IdNr. beim Erwerb
  const [weitereOffen, setWeitereOffen] = useState(() => doc.currency !== "EUR" || issues.some((issue) => inWeitereAngaben(issue.feld)));
  // Bei Fremdwährung stehen in den Zeilen die Beträge laut Beleg; Euro rechnet Haben mit dem Kurs aus
  const [rows, setRows] = useState<AmountState[]>(() =>
    (amounts.length > 0 ? amounts : [{ taxRate: 1900, net: 0, tax: 0, originalNet: null, originalTax: null, vorsteuerAnteil: null }]).map((a) => {
      const net = doc.currency === "EUR" ? a.net : (a.originalNet ?? 0);
      const tax = calculateInitialTax ? taxOf(net, a.taxRate) : doc.currency === "EUR" ? a.tax : (a.originalTax ?? 0);
      return {
        ...betragszeileGespeichert(nextRowKey(), a.taxRate as Rate, net, tax, amounts.length === 0),
        vorsteuerAnteil: formatVorsteuerAnteil(a.vorsteuerAnteil),
      };
    }),
  );
  // Aufteilung auf mehrere Kategorien (#271); leer = die Kategorie gilt für den ganzen Beleg
  const [splitRows, setSplitRows] = useState<SplitRowState[]>(() =>
    splits.map((s) => splitRow(s.category as ExpenseCategory, s.taxRate as Rate, formatDecimal(s.net), s.ownAccountId ?? "")),
  );
  const splitting = splitRows.length > 0;
  const [dirty, setDirty] = useState(
    () => calculateInitialTax && amounts.some((a, index) => parseEuro(rows[index]!.tax) !== (doc.currency === "EUR" ? a.tax : (a.originalTax ?? 0))),
  );
  const { busy, notice, run } = useAction();

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const parsed = rows.map((r) => ({
    taxRate: r.taxRate,
    net: parseEuro(r.net || "0"),
    tax: parseEuro(r.tax || "0"),
    vorsteuerAnteil: parseVorsteuerAnteil(r.vorsteuerAnteil),
  }));
  // Mit Aufteilung gibt es (noch) keinen Privatanteil, siehe Grenzen in docs/belege.md
  const privateShareValue = category === "anlage" || splitting ? 0 : parsePrivatanteil(privateShare);
  const privateShareValid = privateShareValue !== null;
  const vorsteuerBeleg = { value: vorsteuerAnteil, company: data, booked: locked, storedDeduction: doc.vorsteuerAbzug };
  const currencyCode = currency.trim().toUpperCase();
  const foreign = currencyCode !== "EUR";
  const rate = exchangeRate.trim() ? parseExchangeRate(exchangeRate) : null;
  const currencyValid = CURRENCY_CODE.test(currencyCode) && (!foreign || !exchangeRate.trim() || rate !== null);
  const parsedSplits = splitting ? parseSplitRows(splitRows) : [];
  const valid =
    parsed.every((p) => p.net !== null && p.tax !== null) &&
    // Ein vertipptes Brutto lässt die vorigen Beträge stehen; bei § 13b gibt es kein Brutto
    (Boolean(reverseCharge) || rows.every(bruttoLesbar)) &&
    new Set(rows.map((r) => r.taxRate)).size === rows.length &&
    privateShareValid &&
    [vorsteuerAnteil, ...rows.map((row) => row.vorsteuerAnteil)].every((text) => text.trim() === "" || parseVorsteuerAnteil(text) !== null) &&
    currencyValid &&
    parsedSplits !== null;
  const BETRAG_FEHLER = amountError("den Betrag", 12_050);
  // Felder in „Weitere Angaben“ heißen wie am Beleg, damit inWeitereAngaben sie erkennt
  const fehler: Record<string, string | null> = {
    currency: CURRENCY_CODE.test(currencyCode) ? null : "Trag den Code der Währung mit drei Buchstaben ein, etwa USD.",
    exchangeRate: foreign && exchangeRate.trim() && rate === null ? "Trag den Kurs als Zahl ein, etwa 1,0812." : null,
    serviceTo: leistungsendeFehler(serviceFrom, serviceTo),
    ...Object.fromEntries(
      rows.flatMap((r, i) => [
        [`satz-${r.key}`, rows.findIndex((x) => x.taxRate === r.taxRate) < i ? "Diesen Satz gibt es schon in einer Zeile darüber." : null],
        [`netto-${r.key}`, parsed[i]!.net === null ? BETRAG_FEHLER : null],
        [`steuer-${r.key}`, parsed[i]!.tax === null ? BETRAG_FEHLER : null],
        [`brutto-${r.key}`, reverseCharge || bruttoLesbar(r) ? null : BETRAG_FEHLER],
        [
          `vorsteuer-${r.key}`,
          r.vorsteuerAnteil.trim() === "" || parsed[i]!.vorsteuerAnteil !== null ? null : "Trag einen Vorsteueranteil von 0 bis 100 % ein.",
        ],
      ]),
    ),
    ...Object.fromEntries(
      splitRows.flatMap((r) => [
        [`kategorie-${r.key}`, r.category === "" ? "Wähle die Kategorie." : null],
        [`aufteilung-${r.key}`, parseEuro(r.net || "0") === null ? BETRAG_FEHLER : null],
      ]),
    ),
    privatanteil: privateShareValid ? null : PRIVATANTEIL_FEHLER,
    vorsteuer: vorsteuerAnteil.trim() === "" || parseVorsteuerAnteil(vorsteuerAnteil) !== null ? null : "Trag einen Vorsteueranteil von 0 bis 100 % ein.",
  };
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
  // Aufteilen geht mit deutscher Umsatzsteuer und mit § 13b (#508), in Euro
  const splitBlocked = reverseCharge === "ig_erwerb" ? "innergemeinschaftlichem Erwerb" : foreign ? "Fremdwährung" : null;
  // § 13b: gezahlt wird netto, die Steuer geht ans Finanzamt
  const gross = valid ? parsed.reduce((s, p) => s + p.net! + (reverseCharge ? 0 : p.tax!), 0) : null;
  // Fremdwährung: dieselbe Umrechnung wie beim Speichern, damit die Vorschau mit dem Gebuchten übereinstimmt
  const euroRows =
    valid && foreign && rate
      ? convertForeignAmounts(
          parsed.map((p) => ({ taxRate: p.taxRate, originalNet: p.net!, originalTax: p.tax! })),
          rate,
          Boolean(reverseCharge),
        )
      : null;
  const euroGross = euroRows ? euroRows.reduce((s, e) => s + e.net + (reverseCharge ? 0 : e.tax), 0) : null;
  // Lieferant mit USt-IdNr. aus einem anderen EU-Land und keine Steuer auf dem Beleg: vermutlich § 13b
  const looksLikeReverseCharge = !reverseCharge && isEuVatId(supplierUstId) && parsed.every((p) => p.tax === 0) && parsed.some((p) => p.net);

  function chooseReverseCharge(value: SelfAssessedTax | null) {
    touch(setReverseCharge)(value);
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
    const first = category === "anlage" ? "" : (category as ExpenseCategory | "");
    const fromAmounts = rows.map((row, i) => splitRow(i === 0 ? first : "", row.taxRate, row.net, i === 0 ? ownAccountId : ""));
    touch(setSplitRows)([...fromAmounts, splitRow("", rows[0]?.taxRate ?? 1900, "")]);
  }

  function touch<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setDirty(true);
    };
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
    setSupplierUstId(supplier.ustId);
  }

  /** Wer den Namen von Hand ändert, meint einen anderen Lieferanten: die Verknüpfung fällt weg */
  function typeSupplierName(name: string) {
    setSupplierName(name);
    if (supplierContactId && data.suppliers.find((s) => s.id === supplierContactId)?.name !== name) setSupplierContactId(null);
  }

  async function persist() {
    await save({
      data: {
        id: doc.id,
        document: {
          supplierName,
          supplierUstId,
          supplierContactId,
          invoiceNumber,
          documentDate: documentDate || null,
          dueDate: dueDate || null,
          serviceFrom: serviceFrom || null,
          serviceTo: serviceTo || null,
          category: splitting ? null : ((category || null) as ExpenseCategory | null),
          ownAccountId: splitting ? null : passendesKonto(ownAccounts, category, ownAccountId) || null,
          payment,
          note,
          privateShare: privateShareValue ?? 0,
          vorsteuerAnteil: parseVorsteuerAnteil(vorsteuerAnteil),
          // Nur an einer Gutschrift über die Bank sinnvoll; sonst schickt der Editor immer „nein“ (#786)
          erstattetBezahltes: gross !== null && gross < 0 && payment === "bank" ? erstattetBezahltes : false,
          reverseCharge,
          currency: currencyCode,
          exchangeRate: foreign ? exchangeRate : null,
          exchangeRateDate: foreign && exchangeRate.trim() && exchangeRateDate ? exchangeRateDate : null,
          asset:
            category === "anlage"
              ? {
                  name: assetName.trim() || supplierName.trim() || "Anlage",
                  kind: assetKind,
                  method: assetMethod,
                  usefulLifeMonths: usesUsefulLife(assetMethod) ? parseUsefulLifeMonths(assetYears) : null,
                }
              : null,
          splits: parsedSplits ?? [],
          amounts: parsed
            .filter((p) => p.net !== 0 || p.tax !== 0)
            .map((p) =>
              foreign
                ? { taxRate: p.taxRate, net: 0, tax: 0, originalNet: p.net!, originalTax: p.tax!, vorsteuerAnteil: p.vorsteuerAnteil }
                : { taxRate: p.taxRate, net: p.net!, tax: p.tax!, vorsteuerAnteil: p.vorsteuerAnteil },
            ),
        },
      },
    });
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
    supplierName,
    supplierUstId,
    setSupplierUstId,
    supplierContactId,
    newSupplierName,
    setNewSupplierName,
    invoiceNumber,
    setInvoiceNumber,
    documentDate,
    setDocumentDate,
    dueDate,
    setDueDate,
    serviceFrom,
    setServiceFrom,
    serviceTo,
    setServiceTo,
    category,
    setCategory,
    ownAccountId,
    setOwnAccountId,
    payment,
    setPayment,
    privateShare,
    setPrivateShare,
    setVorsteuerAnteil,
    erstattetBezahltes,
    setErstattetBezahltes,
    assetName,
    setAssetName,
    assetKind,
    setAssetKind,
    assetMethod,
    setAssetMethod,
    assetYears,
    setAssetYears,
    note,
    setNote,
    reverseCharge,
    currency,
    setCurrency,
    exchangeRate,
    setExchangeRate,
    exchangeRateDate,
    setExchangeRateDate,
    weitereOffen,
    setWeitereOffen,
    rows,
    setRows,
    splitRows,
    setSplitRows,
    splitting,
    dirty,
    setDirty,
    busy,
    notice,
    run,
    parsed,
    privateShareValue,
    vorsteuerBeleg,
    currencyCode,
    foreign,
    rate,
    form,
    error,
    pruefen,
    mitFeldfehlern,
    splitBlocked,
    gross,
    euroRows,
    euroGross,
    looksLikeReverseCharge,
    chooseReverseCharge,
    startSplitting,
    touch,
    updateRow,
    pickSupplier,
    typeSupplierName,
    persist,
    onSave,
  };
}

export type DocumentFormState = ReturnType<typeof useDocumentForm>;

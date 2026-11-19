import { formatDecimal, formatExchangeRate, parseEuro, taxOf, type AssetKind, type AssetMethod, type ExpenseCategory, type SelfAssessedTax } from "@haben/core";
import { useState } from "react";
import { splitRow, type SplitRowState } from "../../../components/DocumentSplits.tsx";
import { formatVorsteuerAnteil } from "../../../components/VorsteuerAnteil.tsx";
import { inWeitereAngaben } from "../../../components/WeitereAngaben.tsx";
import { betragszeileGespeichert } from "../../../lib/betragszeile.ts";
import type { Detail } from "./-beleg-vorschau.tsx";
import { type AmountState, nextRowKey, type Rate } from "./-beleg-zeile.ts";

// Eingabestand des Belegformulars: Felder, Betragszeilen und Aufteilung (useDocumentForm in -beleg-zustand.ts)

/** Lieferant, Daten, Kategorie, Zahlung, Notiz und Anlage, vorbelegt mit dem gespeicherten Stand */
function useBelegdatenFields(doc: Detail["document"]) {
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
  // Angaben zur Anlage bei Kategorie „anlage“; Vorschläge laut AfA-Tabelle
  const [assetName, setAssetName] = useState(doc.asset?.name ?? "");
  const [assetKind, setAssetKind] = useState<AssetKind>(doc.asset?.kind ?? "edv");
  const [assetMethod, setAssetMethod] = useState<AssetMethod>(doc.asset?.method ?? "digital");
  const [assetYears, setAssetYears] = useState(doc.asset?.usefulLifeMonths ? String(doc.asset.usefulLifeMonths / 12) : "");
  const [note, setNote] = useState(doc.note);
  return {
    supplierName,
    setSupplierName,
    supplierUstId,
    setSupplierUstId,
    supplierContactId,
    setSupplierContactId,
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
  };
}

/** Privatanteil, Vorsteuer, § 13b und Währung; dazu, ob „Weitere Angaben“ offen stehen */
function useSteuerFields(doc: Detail["document"], issues: Detail["issues"]) {
  const [privateShare, setPrivateShare] = useState(doc.privateShare ? String(doc.privateShare) : "");
  // Leer = Firmenvorgabe, sonst wirtschaftlich zugeordneter Anteil mit bis zu zwei Nachkommastellen.
  const [vorsteuerAnteil, setVorsteuerAnteil] = useState(formatVorsteuerAnteil(doc.vorsteuerAnteil));
  // Gutschrift erstattet bereits Bezahltes (#786): die Vorsteuerminderung wartet auf den Ausgleich
  const [erstattetBezahltes, setErstattetBezahltes] = useState(doc.erstattetBezahltes);
  const [reverseCharge, setReverseCharge] = useState<SelfAssessedTax | null>(doc.reverseCharge ?? null);
  const [currency, setCurrency] = useState(doc.currency);
  const [exchangeRate, setExchangeRate] = useState(doc.exchangeRate ? formatExchangeRate(doc.exchangeRate) : "");
  const [exchangeRateDate, setExchangeRateDate] = useState(doc.exchangeRateSource === "ust" ? "" : (doc.exchangeRateDate ?? ""));
  // „Weitere Angaben“ stehen offen, wo sie gebraucht werden: bei Fremdwährung (Kurs) und wenn ein Hinweis „Vor dem Buchen“ an
  // einem Feld darin liegt, etwa an der USt-IdNr. beim Erwerb
  const [weitereOffen, setWeitereOffen] = useState(() => doc.currency !== "EUR" || issues.some((issue) => inWeitereAngaben(issue.feld)));
  return {
    privateShare,
    setPrivateShare,
    vorsteuerAnteil,
    setVorsteuerAnteil,
    erstattetBezahltes,
    setErstattetBezahltes,
    reverseCharge,
    setReverseCharge,
    currency,
    setCurrency,
    exchangeRate,
    setExchangeRate,
    exchangeRateDate,
    setExchangeRateDate,
    weitereOffen,
    setWeitereOffen,
  };
}

/** Die Felder des Belegs außer Beträgen und Aufteilung */
export function useDocumentFields(doc: Detail["document"], issues: Detail["issues"]) {
  return { ...useBelegdatenFields(doc), ...useSteuerFields(doc, issues) };
}

export type DocumentFields = ReturnType<typeof useDocumentFields>;

/** Betragszeilen, Aufteilung und ob etwas ungespeichert ist */
export function useDocumentRows(data: Detail, calculateInitialTax: boolean) {
  const { document: doc, amounts, splits } = data;
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
  return { rows, setRows, splitRows, setSplitRows, splitting, dirty, setDirty };
}

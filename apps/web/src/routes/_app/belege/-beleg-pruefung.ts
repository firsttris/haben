import { amountError, convertForeignAmounts, CURRENCY_CODE, parseEuro, parseExchangeRate, usesUsefulLife, type ExpenseCategory } from "@haben/core";
import { parseSplitRows, type SplitRowState } from "../../../components/DocumentSplits.tsx";
import { passendesKonto } from "../../../components/EigenesKontoWahl.tsx";
import { parseVorsteuerAnteil } from "../../../components/VorsteuerAnteil.tsx";
import { isEuVatId, leistungsendeFehler } from "../../../components/WeitereAngaben.tsx";
import { PRIVATANTEIL_FEHLER, parsePrivatanteil } from "../../../lib/anteil.ts";
import { bruttoLesbar } from "../../../lib/betragszeile.ts";
import { parseUsefulLifeMonths } from "../../../lib/format.ts";
import type { DocumentFields } from "./-beleg-felder.ts";
import type { Detail } from "./-beleg-vorschau.tsx";
import type { AmountState } from "./-beleg-zeile.ts";

// Aus dem Eingabestand des Belegformulars gerechnet: gelesene Beträge, Summen, Fehler je Feld und was gespeichert wird

/** Gelesene Beträge, Gültigkeit, Brutto und Euro-Umrechnung des Eingabestands */
export function documentFigures(f: DocumentFields, rows: AmountState[], splitRows: SplitRowState[], data: Detail, locked: boolean) {
  const { reverseCharge, exchangeRate } = f;
  const splitting = splitRows.length > 0;
  const parsed = rows.map((r) => ({
    taxRate: r.taxRate,
    net: parseEuro(r.net || "0"),
    tax: parseEuro(r.tax || "0"),
    vorsteuerAnteil: parseVorsteuerAnteil(r.vorsteuerAnteil),
  }));
  // Mit Aufteilung gibt es (noch) keinen Privatanteil, siehe Grenzen in docs/belege.md
  const privateShareValue = f.category === "anlage" || splitting ? 0 : parsePrivatanteil(f.privateShare);
  const privateShareValid = privateShareValue !== null;
  const vorsteuerBeleg = { value: f.vorsteuerAnteil, company: data, booked: locked, storedDeduction: data.document.vorsteuerAbzug };
  const currencyCode = f.currency.trim().toUpperCase();
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
    [f.vorsteuerAnteil, ...rows.map((row) => row.vorsteuerAnteil)].every((text) => text.trim() === "" || parseVorsteuerAnteil(text) !== null) &&
    currencyValid &&
    parsedSplits !== null;
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
  const looksLikeReverseCharge = !reverseCharge && isEuVatId(f.supplierUstId) && parsed.every((p) => p.tax === 0) && parsed.some((p) => p.net);
  return {
    parsed,
    privateShareValue,
    privateShareValid,
    vorsteuerBeleg,
    currencyCode,
    foreign,
    rate,
    parsedSplits,
    splitBlocked,
    gross,
    euroRows,
    euroGross,
    looksLikeReverseCharge,
  };
}

export type DocumentFigures = ReturnType<typeof documentFigures>;

/** Fehler je Feld; Felder in „Weitere Angaben“ heißen wie am Beleg, damit inWeitereAngaben sie erkennt */
export function documentFieldErrors(
  f: DocumentFields,
  rows: AmountState[],
  splitRows: SplitRowState[],
  figures: DocumentFigures,
): Record<string, string | null> {
  const { parsed, currencyCode, foreign, rate } = figures;
  const BETRAG_FEHLER = amountError("den Betrag", 12_050);
  return {
    currency: CURRENCY_CODE.test(currencyCode) ? null : "Trag den Code der Währung mit drei Buchstaben ein, etwa USD.",
    exchangeRate: foreign && f.exchangeRate.trim() && rate === null ? "Trag den Kurs als Zahl ein, etwa 1,0812." : null,
    serviceTo: leistungsendeFehler(f.serviceFrom, f.serviceTo),
    ...Object.fromEntries(
      rows.flatMap((r, i) => [
        [`satz-${r.key}`, rows.findIndex((x) => x.taxRate === r.taxRate) < i ? "Diesen Satz gibt es schon in einer Zeile darüber." : null],
        [`netto-${r.key}`, parsed[i]!.net === null ? BETRAG_FEHLER : null],
        [`steuer-${r.key}`, parsed[i]!.tax === null ? BETRAG_FEHLER : null],
        [`brutto-${r.key}`, f.reverseCharge || bruttoLesbar(r) ? null : BETRAG_FEHLER],
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
    privatanteil: figures.privateShareValid ? null : PRIVATANTEIL_FEHLER,
    vorsteuer: f.vorsteuerAnteil.trim() === "" || parseVorsteuerAnteil(f.vorsteuerAnteil) !== null ? null : "Trag einen Vorsteueranteil von 0 bis 100 % ein.",
  };
}

/** Was saveDocument als Beleg bekommt */
export function documentInput(f: DocumentFields, figures: DocumentFigures, splitting: boolean, ownAccounts: Detail["ownAccounts"]) {
  const { category, exchangeRate, assetMethod } = f;
  const { parsed, foreign, gross } = figures;
  return {
    supplierName: f.supplierName,
    supplierUstId: f.supplierUstId,
    supplierContactId: f.supplierContactId,
    invoiceNumber: f.invoiceNumber,
    documentDate: f.documentDate || null,
    dueDate: f.dueDate || null,
    serviceFrom: f.serviceFrom || null,
    serviceTo: f.serviceTo || null,
    category: splitting ? null : ((category || null) as ExpenseCategory | null),
    ownAccountId: splitting ? null : passendesKonto(ownAccounts, category, f.ownAccountId) || null,
    payment: f.payment,
    note: f.note,
    privateShare: figures.privateShareValue ?? 0,
    vorsteuerAnteil: parseVorsteuerAnteil(f.vorsteuerAnteil),
    // Nur an einer Gutschrift über die Bank sinnvoll; sonst schickt der Editor immer „nein“ (#786)
    erstattetBezahltes: gross !== null && gross < 0 && f.payment === "bank" ? f.erstattetBezahltes : false,
    reverseCharge: f.reverseCharge,
    currency: figures.currencyCode,
    exchangeRate: foreign ? exchangeRate : null,
    exchangeRateDate: foreign && exchangeRate.trim() && f.exchangeRateDate ? f.exchangeRateDate : null,
    asset:
      category === "anlage"
        ? {
            name: f.assetName.trim() || f.supplierName.trim() || "Anlage",
            kind: f.assetKind,
            method: assetMethod,
            usefulLifeMonths: usesUsefulLife(assetMethod) ? parseUsefulLifeMonths(f.assetYears) : null,
          }
        : null,
    splits: figures.parsedSplits ?? [],
    amounts: parsed
      .filter((p) => p.net !== 0 || p.tax !== 0)
      .map((p) =>
        foreign
          ? { taxRate: p.taxRate, net: 0, tax: 0, originalNet: p.net!, originalTax: p.tax!, vorsteuerAnteil: p.vorsteuerAnteil }
          : { taxRate: p.taxRate, net: p.net!, tax: p.tax!, vorsteuerAnteil: p.vorsteuerAnteil },
      ),
  };
}

import { finish, indexed, requireAmount, type Tx } from "./common.ts";
import { isBlankRow } from "./csv.ts";
import { StatementParseError } from "./errors.ts";
import { pspDate, skippedWarning } from "./psp.ts";
import { Columns } from "./table.ts";
import { normalizeText, parseDate, parseDotAmount } from "./text.ts";
import type { ParsedStatement } from "./types.ts";

/*
 * Monatsabrechnung von Etsy (Finanzen › Monatliche Abrechnungen › CSV herunterladen). Eine öffentliche Beschreibung gibt
 * es nicht; der Aufbau stammt aus zwei echten Dateien im Issue #296: einer deutschen (Lucifus01, Datum „05. November
 * 2026“) und einer englischen (dylancaponi, Datum „March 31, 2025“). Kopfzeile und Datum folgen der Sprache des Kontos,
 * die Zeilenarten (Sale, Fee, Marketing, Tax, Refund) standen in beiden Dateien englisch, die Auszahlung als
 * „Überweisung“ bzw. „Deposit“.
 *
 * Die Beträge haben einen Dezimalpunkt und ein Währungszeichen („€8.73“, „-€0.08“, „€1,250.00“), leere Zellen stehen als
 * „--“, die neueste Zeile steht oben. Eine Zeile hat entweder einen Betrag (Verkauf, Erstattung) oder Gebühren und
 * Steuern (Gebühr, Werbung, Steuer); „Netto“ ist die Summe aus beiden. Zwei Besonderheiten:
 *
 * - Bei der Auszahlung sind alle Betragsspalten leer, der Betrag steht nur im Titel („€69.75 an dein Bankkonto
 *   überwiesen“).
 * - „Tax“ ist die Steuer des Käufers, die Etsy abführt: Sie steckt im Verkauf und wird mit einer eigenen Zeile wieder
 *   abgezogen (bei Erstattungen umgekehrt). Das ist keine Gebühr und kein Erlös. Haben verrechnet sie wie bei eBay mit dem
 *   Verkauf bzw. der Erstattung derselben Bestellung (settleTax), damit der Verkauf mit dem Rechnungsbetrag ankommt;
 *   findet sich nicht genau einer, bleibt sie als „Umsatzsteuer“ mit Nettobetrag und Warnung stehen.
 *
 * Wie bei den übrigen Zahlungsdienstleistern wird der Bruttobetrag eines Verkaufs vom Rest getrennt: Hat eine Zeile
 * Betrag und Gebühren, entstehen zwei Umsätze. Jede Gebührenzeile bleibt ein eigener Umsatz. Die Auszahlung ist ein
 * negativer Umsatz und wird im Bankabgleich als Geldtransit mit dem Eingang auf dem Bankkonto verbunden. Zeilen
 * unbekannter Art gehen mit dem Nettobetrag ein, damit das Guthaben stimmt, und werden gemeldet.
 */

const DATE = ["datum", "date"];
const TYPE = ["art", "type"];
const TITLE = ["titel", "title"];
const AMOUNT = ["betrag", "amount"];
// „Gebühren & Steuern“ bzw. „Fees & Taxes“ ohne Sonderzeichen
const FEES = ["gebührensteuern", "feestaxes"];
const NET = ["netto", "net"];

export function isEtsyHeader(c: Columns): boolean {
  return c.has(...DATE) && c.has(...TYPE) && c.has(...TITLE) && c.has("info") && c.has(...AMOUNT) && c.has(...FEES) && c.has(...NET);
}

/** Etsy schreibt „--“ in leere Felder */
const value = (get: (row: string[]) => string) => (row: string[]) => {
  const raw = get(row);
  return raw === "--" ? "" : raw;
};

/** Monate nach den ersten drei Buchstaben: deutsch („März“, „Mai“, „Okt.“) und englisch („March“, „May“, „Oct.“) */
const MONTHS_DE = ["jan", "feb", "mär", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "dez"];
const MONTHS_EN = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const monthNumber = (name: string, names: string[]) => names.indexOf(name.toLowerCase().slice(0, 3)) + 1;

/** Datum aus „05. November 2026“ (deutsch) oder „March 31, 2025“ (englisch); sonst die Formate der übrigen Dienstleister */
function etsyDate(raw: string, where: string): string {
  const text = raw.trim();
  const german = /^(\d{1,2})\.\s*([a-zäöü]+)\.?\s+(\d{4})$/i.exec(text);
  const english = /^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(text);
  const parts = german
    ? { day: german[1]!, month: monthNumber(german[2]!, MONTHS_DE), year: german[3]! }
    : english
      ? { day: english[2]!, month: monthNumber(english[1]!, MONTHS_EN), year: english[3]! }
      : null;
  if (parts === null || parts.month === 0) return pspDate(raw, where);
  const parsed = parseDate(`${parts.day}.${parts.month}.${parts.year}`);
  if (!parsed) throw new StatementParseError(`Ungültiges Datum „${raw}“ (${where}).`);
  return parsed;
}

/** Zeilenarten, die Haben kennt, mit der Bezeichnung des Umsatzes; Etsy schreibt sie englisch, hier auch deutsch */
const KINDS: [RegExp, string][] = [
  [/^(sale|verkauf)$/i, "Verkauf"],
  [/^(fee|gebühr|gebühren)$/i, "Gebühr"],
  [/^(marketing|werbung)$/i, "Werbung"],
  [/^(tax|steuer|steuern)$/i, "Umsatzsteuer"],
  [/^(refund|erstattung|rückerstattung)$/i, "Erstattung"],
];
const labelOf = (kind: string) => KINDS.find(([pattern]) => pattern.test(kind))?.[1];
const isPayout = (kind: string) => /^(deposit|überweisung|ueberweisung|auszahlung|payout)$/i.test(kind);

/** Betrag der Auszahlung aus dem Titel, etwa „€1,225.76 sent to your bank account“, als negativer Umsatz */
const PAYOUT_AMOUNT = /€\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/;

function payoutAmount(title: string, where: string): number {
  const found = PAYOUT_AMOUNT.exec(title);
  const cents = found ? parseDotAmount(found[1]!) : null;
  if (cents === null) throw new StatementParseError(`Der Betrag der Auszahlung steht nicht im Titel „${title}“ (${where}).`);
  return -cents;
}

/** Bestellnummer aus „Payment for Order #N“, „Order #N“ oder (deutsche Dateien) „Bestellnr. N“ */
const ORDER = /(?:order\s*#|bestellnr\.?)\s*([^\s,]+)/i;

function orderOf(...texts: string[]): string | undefined {
  for (const text of texts) {
    const found = ORDER.exec(text);
    if (found) return found[1];
  }
  return undefined;
}

/** Umsätze, die zu einer Bestellung gehören und mit einer Steuerzeile verrechnet werden können */
const ORDER_TYPES = new Set(["Verkauf", "Erstattung", "Umsatzsteuer"]);

/**
 * Verrechnet die Steuer des Käufers, die Etsy abführt, mit dem Verkauf derselben Bestellung (negative Steuer) bzw. mit der
 * Erstattung (positive Steuer), wie bei eBay: Der Verkauf kommt dann mit dem Betrag der Rechnung an. Gibt es nicht genau
 * einen solchen Verkauf oder eine solche Erstattung in der Datei (etwa über die Monatsgrenze oder bei mehreren
 * Teilerstattungen), bleibt die Zeile einzeln, damit nichts geraten wird; die Anzahl dieser Zeilen steht in `unsettled`.
 */
function settleTax(list: Tx[], orders: Map<Tx, string>): { list: Tx[]; unsettled: number } {
  const adjustment = new Map<Tx, number>();
  const settled = new Set<Tx>();
  const taxes = list.filter((t) => t.type === "Umsatzsteuer");
  for (const tax of taxes) {
    const order = orders.get(tax);
    const wanted = tax.amount < 0 ? "Verkauf" : "Erstattung";
    const targets = list.filter((t) => order !== undefined && t.type === wanted && orders.get(t) === order);
    if (targets.length !== 1) continue;
    adjustment.set(targets[0]!, (adjustment.get(targets[0]!) ?? 0) + tax.amount);
    settled.add(tax);
  }
  const result = list.filter((t) => !settled.has(t)).map((t) => (adjustment.has(t) ? { ...t, amount: t.amount + adjustment.get(t)! } : t));
  return { list: result, unsettled: taxes.length - settled.size };
}

function unsettledTaxWarning(count: number): string[] {
  if (count === 0) return [];
  return [`${count} ${count === 1 ? "Steuerzeile" : "Steuerzeilen"} ohne Verkauf oder Erstattung derselben Bestellung mit dem Nettobetrag übernommen.`];
}

function unknownKindsWarning(kinds: string[]): string[] {
  if (kinds.length === 0) return [];
  const names = [...new Set(kinds)].map((kind) => kind || "ohne Art").join(", ");
  return [`${kinds.length} ${kinds.length === 1 ? "Zeile" : "Zeilen"} mit unbekannter Art (${names}) mit dem Nettobetrag übernommen.`];
}

/** Monatsabrechnung von Etsy (Spalten und Datum deutsch oder englisch), nur Zeilen in Euro */
export function parseEtsy(rows: string[][], headerRow: number): ParsedStatement {
  const c = new Columns(rows[headerRow]!);
  const date = value(c.getter(...DATE));
  const type = value(c.getter(...TYPE));
  const title = value(c.getter(...TITLE));
  const info = value(c.getter("info"));
  const currency = value(c.getter("währung", "currency"));
  const amount = value(c.getter(...AMOUNT));
  const fees = value(c.getter(...FEES));
  const net = value(c.getter(...NET));

  const list: Tx[] = [];
  const orders = new Map<Tx, string>();
  const unknownKinds: string[] = [];
  let foreign = 0;
  let empty = 0;
  rows.slice(headerRow + 1).forEach((row, i) => {
    if (isBlankRow(row)) return;
    const where = `Zeile ${headerRow + i + 2}`;
    if (currency(row) && currency(row).toUpperCase() !== "EUR") {
      foreign++;
      return;
    }
    const kind = normalizeText(type(row));
    /** Zweck aus einem Anfang, dem Titel und der Info der Zeile */
    const describe = (first: string) => [first, normalizeText(title(row)), normalizeText(info(row))].filter(Boolean).join(" · ");
    const purpose = describe(kind);
    const base = { bookingDate: etsyDate(date(row), where), currency: "EUR", counterpartyName: "Etsy" };
    const cents = (raw: string) => (raw ? requireAmount(parseDotAmount(raw), raw, where) : 0);
    // Verkäufe, Erstattungen und Steuerzeilen merken sich ihre Bestellung für settleTax; die Steuerzeile nennt sie in der
    // Info, der Verkauf im Titel
    const order = labelOf(kind) === "Umsatzsteuer" ? orderOf(info(row), title(row)) : orderOf(title(row), info(row));
    const add = (tx: Tx) => {
      list.push(tx);
      if (order !== undefined && tx.type !== undefined && ORDER_TYPES.has(tx.type)) orders.set(tx, order);
    };

    if (isPayout(kind)) {
      // Haben erkennt eine Auszahlung im Konto des Dienstleisters am Wort „Auszahlung“ im Zweck (PAYOUT_PURPOSE in
      // @haben/core); Etsy nennt sie je nach Sprache „Überweisung“, „Deposit“ oder anders
      list.push({ ...base, amount: payoutAmount(title(row), where), purpose: describe("Auszahlung"), type: "Auszahlung" });
      return;
    }
    const label = labelOf(kind);
    // Gebühren beginnen mit „Gebühr“ wie bei den übrigen Dienstleistern: Darauf baut die Zuordnung zur Sammelrechnung
    // (allocateFeesToDocument und der Knopf im Bankabgleich suchen Zwecke, die so beginnen). Etsy-Gebührenzeilen
    // haben keinen Betrag, nur „Gebühren & Steuern“, und bekämen den Anfang sonst nie. Auch Werbung (Etsy Ads, Offsite
    // Ads) steht auf der monatlichen Gebührenrechnung von Etsy und gehört dazu; die Art bleibt „Werbung“.
    const rowPurpose = label === "Gebühr" || label === "Werbung" ? describe("Gebühr") : purpose;
    // Ohne bekannte Art oder ohne Betrag und Gebühren zählt nur der Nettobetrag, sonst stimmte das Guthaben nicht
    if (label === undefined || (!amount(row) && !fees(row))) {
      if (!net(row)) {
        empty++;
        return;
      }
      if (label === undefined) unknownKinds.push(kind);
      add({ ...base, amount: cents(net(row)), purpose: rowPurpose, type: label ?? (kind || undefined) });
      return;
    }
    const gross = cents(amount(row));
    const fee = cents(fees(row));
    if (gross !== 0) add({ ...base, amount: gross, purpose: rowPurpose, type: label });
    if (fee !== 0) {
      add(gross !== 0 ? { ...base, amount: fee, purpose: `Gebühr · ${purpose}`, type: "Gebühr" } : { ...base, amount: fee, purpose: rowPurpose, type: label });
    }
  });
  const settled = settleTax(list, orders);
  // Die Datei beginnt mit der neuesten Zeile; gleiche Tage behalten ihre Reihenfolge
  settled.list.sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));
  return finish({
    format: "etsy-csv",
    currency: "EUR",
    transactions: indexed(settled.list),
    warnings: [
      ...skippedWarning(foreign, "nicht in Euro"),
      ...skippedWarning(empty, "ohne Betrag"),
      ...unknownKindsWarning(unknownKinds),
      ...unsettledTaxWarning(settled.unsettled),
    ],
  });
}

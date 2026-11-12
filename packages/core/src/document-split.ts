import type { InvoiceTotals } from "./invoice.ts";
import { formatEuro, roundHalfAwayFromZero, type BasisPoints, type Cents } from "./money.ts";
import {
  ACCOUNTS,
  EXPENSE_CATEGORIES,
  inputTaxCode,
  ownerAccount,
  REVERSE_CHARGE_IN,
  side,
  type ReverseChargeIn,
  type DocumentPayment,
  type ExpenseCategory,
  type Kontenrahmen,
  type PostingLine,
  type TaxCode,
} from "./posting.ts";
import type { Rechtsform } from "./rechtsform.ts";

/*
 * Aufteilung eines Eingangsbelegs auf mehrere Kontierungszeilen (#271): Ein Beleg, eine Zahlung, ein offener Posten, aber
 * das Netto geht auf verschiedene Kategorien, z. B. Handelsware, Software und Bürobedarf auf derselben Rechnung.
 *
 * Maßgeblich bleiben die Beträge des Belegs je Steuersatz (document_amounts): Die Vorsteuer steht auf der Rechnung und
 * wird wie bisher nicht nachgerechnet. Die Zeilen tragen Kategorie, Steuersatz und Netto; ihr Netto muss je Satz genau
 * das Netto des Belegs ergeben. Die Vorsteuer eines Satzes verteilt Haben anteilig nach Netto auf seine Zeilen und rundet
 * kaufmännisch; den Rundungsrest trägt die betragsmäßig größte Zeile des Satzes, wie beim Netto einer Bruttorechnung
 * (computeInvoice) und beim Steueranteil einer Teilzahlung (paidTaxShares). So ergeben die Zeilen je Satz exakt Netto
 * und Vorsteuer des Belegs.
 */

/** Eine Kontierungszeile, wie sie eingegeben wird */
export interface DocumentSplitLine {
  category: ExpenseCategory;
  taxRate: BasisPoints;
  net: Cents;
}

/** Kontierungszeile mit ihrem Anteil an der Vorsteuer des Satzes */
export interface AllocatedSplitLine extends DocumentSplitLine {
  tax: Cents;
}

/** Beträge des Belegs je Steuersatz */
export interface DocumentRateAmount {
  taxRate: BasisPoints;
  net: Cents;
  tax: Cents;
}

const sum = (values: Cents[]) => values.reduce((s, v) => s + v, 0);

/**
 * Verteilt die Vorsteuer je Satz anteilig nach Netto auf die Zeilen dieses Satzes; die Summe je Satz ist exakt die Steuer
 * des Belegs. Stimmt das Netto der Zeilen (noch) nicht, wird nach ihrem eigenen Netto verteilt; ohne Netto bleibt die
 * Steuer bei 0, das meldet splitIssues.
 */
export function allocateSplitTax(lines: DocumentSplitLine[], amounts: DocumentRateAmount[]): AllocatedSplitLine[] {
  const result: AllocatedSplitLine[] = lines.map((line) => ({ ...line, tax: 0 }));
  for (const amount of amounts) {
    const indexes = lines.flatMap((line, i) => (line.taxRate === amount.taxRate ? [i] : []));
    const base = sum(indexes.map((i) => lines[i]!.net));
    if (indexes.length === 0 || base === 0) continue;
    for (const i of indexes) result[i]!.tax = roundHalfAwayFromZero((amount.tax * lines[i]!.net) / base);
    const rest = amount.tax - sum(indexes.map((i) => result[i]!.tax));
    const largest = indexes.reduce((best, i) => (Math.abs(lines[i]!.net) > Math.abs(lines[best]!.net) ? i : best), indexes[0]!);
    result[largest]!.tax += rest;
  }
  return result;
}

const percent = (rate: BasisPoints) => `${rate / 100} %`;

/**
 * Was gegen die Aufteilung spricht; leere Liste = sie passt zum Beleg. Geprüft wird je Steuersatz: Netto der Zeilen
 * gleich Netto des Belegs, die verteilte Vorsteuer gleich der Vorsteuer des Belegs, und jede Zeile mit demselben
 * Vorzeichen wie der Beleg (eine Gutschrift hat nur negative Zeilen).
 */
export function splitIssues(lines: AllocatedSplitLine[], amounts: DocumentRateAmount[]): string[] {
  const issues: string[] = [];
  if (lines.length < 2) issues.push("Eine Aufteilung braucht mindestens zwei Zeilen; für eine Kategorie wähle sie direkt");
  if (lines.some((line) => line.category === "anlage")) issues.push("Anlagegüter lassen sich nicht aufteilen; erfasse sie als eigenen Beleg");
  if (lines.some((line) => line.net === 0)) issues.push("Jede Zeile der Aufteilung braucht einen Nettobetrag");
  const rates = [...new Set([...amounts.map((a) => a.taxRate), ...lines.map((l) => l.taxRate)])].sort((a, b) => b - a);
  for (const rate of rates) {
    const amount = amounts.find((a) => a.taxRate === rate) ?? { taxRate: rate, net: 0, tax: 0 };
    const own = lines.filter((line) => line.taxRate === rate);
    const net = sum(own.map((line) => line.net));
    if (net !== amount.net) {
      issues.push(`Aufteilung ${percent(rate)}: Zeilen zusammen ${formatEuro(net)} netto, Beleg ${formatEuro(amount.net)}`);
      continue;
    }
    const tax = sum(own.map((line) => line.tax));
    if (tax !== amount.tax) issues.push(`Aufteilung ${percent(rate)}: Vorsteuer der Zeilen ${formatEuro(tax)}, Beleg ${formatEuro(amount.tax)}`);
    // Nicht am Vorzeichen des Belegs gemessen: In einem Satz, den der Beleg nicht hat (Netto 0), höben sich +x und −x sonst auf
    if (own.some((line) => line.net > 0) && own.some((line) => line.net < 0)) {
      issues.push(`Aufteilung ${percent(rate)}: Zeilen mit Plus und Minus gemischt; eine Gutschrift hat nur negative Zeilen`);
    }
  }
  return issues;
}

/**
 * Buchung eines aufgeteilten Belegs: eine Buchung mit einer Aufwandszeile je Kategorie und Steuersatz (gleiche Kategorie
 * und gleicher Satz zusammengefasst), Vorsteuer je Satz in Höhe des Belegs, an Verbindlichkeiten, Privateinlage bzw.
 * Gesellschafter oder Kasse über den ganzen Betrag. Ohne Vorsteuerabzug (Kleinunternehmer) gehört der Steueranteil jeder
 * Zeile zu ihrem Aufwand. Gutschriften (negativ) drehen die Seiten. Privatanteil, innergemeinschaftlicher Erwerb und
 * Anlagegüter gibt es mit Aufteilung nicht (siehe bookingIssues); totals sind die Beträge des Belegs je Satz.
 *
 * § 13b (#508) wie in documentPosting: Der Aufwand jeder Zeile trägt RC13bEU bzw. RC13bDrittland, die selbst geschuldete
 * Steuer steht je Satz einmal als Umsatzsteuer und, mit Vorsteuerabzug, im selben Betrag als Vorsteuer (VSt13b); gezahlt
 * wird nur netto (totals.gross = Netto). Ohne Vorsteuerabzug ist die Steuer Aufwand: je Zeile ihr Anteil aus
 * allocateSplitTax, so ergibt die Summe centgenau die Steuer des Belegs; er steht als eigene Zeile mit keineVSt neben dem
 * Netto, damit die Bemessungsgrundlage (Kz 46/84) im Journal stimmt.
 */
export function documentSplitPosting(
  totals: InvoiceTotals,
  lines: AllocatedSplitLine[],
  kontenrahmen: Kontenrahmen,
  rechtsform: Rechtsform,
  payment: DocumentPayment,
  vorsteuerAbzug = true,
  reverseCharge: ReverseChargeIn | null = null,
): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  if (reverseCharge && !(reverseCharge in REVERSE_CHARGE_IN)) throw new RangeError(`${reverseCharge} mit Aufteilung wird nicht unterstützt`);
  const rcCode = reverseCharge ? REVERSE_CHARGE_IN[reverseCharge].code : null;
  if (rcCode && totals.taxes.some((t) => t.rate !== 1900 && t.rate !== 700)) throw new RangeError("§ 13b: Steuersatz muss 19 % oder 7 % sein");
  const expenses = new Map<string, { account: string; amount: Cents; code: TaxCode }>();
  const add = (account: string, code: TaxCode, amount: Cents) => {
    const key = `${account}|${code}`;
    const seen = expenses.get(key);
    if (seen) seen.amount += amount;
    else expenses.set(key, { account, amount, code });
  };
  for (const line of lines) {
    const account = EXPENSE_CATEGORIES[line.category][kontenrahmen];
    if (vorsteuerAbzug) add(account, rcCode ?? inputTaxCode(line.taxRate), line.net);
    else if (rcCode) {
      // § 13b ohne Vorsteuerabzug: Netto mit dem Steuerschlüssel, die Steuer als Aufwand daneben, damit das Journal die
      // Bemessungsgrundlage trägt (#542)
      add(account, rcCode, line.net);
      add(account, "keineVSt", line.tax);
    } else add(account, "keineVSt", line.net + line.tax);
  }
  const result: PostingLine[] = [...expenses.values()].map((e) => side(e.account, e.amount, true, e.code));
  for (const { rate, tax } of totals.taxes) {
    if (tax === 0) continue;
    if (rate !== 1900 && rate !== 700) throw new RangeError(`Steuersatz ${rate} wird nicht unterstützt`);
    if (rcCode) {
      if (vorsteuerAbzug) result.push(side(accounts.vorsteuerRc, tax, true, "VSt13b"));
      result.push(side(accounts.ustRc, tax, false, rcCode));
    } else if (vorsteuerAbzug) result.push(side(accounts.vorsteuer[rate], tax, true, inputTaxCode(rate)));
  }
  const counter = payment === "privat" ? ownerAccount(kontenrahmen, rechtsform, "einlage") : payment === "kasse" ? accounts.kasse : accounts.verbindlichkeiten;
  result.push(side(counter, totals.gross, false, null));
  return result.filter((line) => line.debit !== 0 || line.credit !== 0);
}

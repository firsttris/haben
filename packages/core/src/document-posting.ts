import type { InvoiceTotals } from "./invoice.ts";
import { splitPrivateShare, type BasisPoints } from "./money.ts";
import { isKapitalgesellschaft, type Rechtsform } from "./rechtsform.ts";
import { abziehbareSteuer, buchungsAnteil } from "./vorsteuerabzug.ts";
import {
  ACCOUNTS,
  EXPENSE_CATEGORIES,
  inputTaxCode,
  ownerAccount,
  REVERSE_CHARGE_IN,
  IG_ERWERB,
  side,
  vatRate,
  type DocumentPayment,
  type ExpenseCategory,
  type Kontenrahmen,
  type PostingLine,
  type SelfAssessedTax,
} from "./posting.ts";

/**
 * Buchung eines Belegs: Aufwand und Vorsteuer an Verbindlichkeiten
 * (oder Privateinlage bzw. Gesellschafter-Verrechnungskonto, wenn privat bezahlt). Gutschriften (negativ) drehen die Seiten.
 * Ohne Vorsteuerabzug (Kleinunternehmer) ist die Steuer Teil des Aufwands.
 */
export function documentPosting(
  totals: InvoiceTotals,
  category: ExpenseCategory,
  kontenrahmen: Kontenrahmen,
  rechtsform: Rechtsform,
  payment: DocumentPayment,
  vorsteuerAbzug: boolean | BasisPoints = true,
  /** Abweichendes Konto statt des Kategoriekontos, z. B. das Anlagekonto einer Anlage */
  account?: string,
  /** Privatanteil in Prozent, z. B. beim Handyvertrag: nur der betriebliche Teil ist Aufwand und Vorsteuer */
  privateShare = 0,
  /**
   * § 13b: Die Steuer in totals schuldest du selbst, gezahlt wird nur netto (totals.gross = Netto).
   * Gebucht wird die Steuer als Umsatzsteuer und, mit Vorsteuerabzug, im selben Betrag als Vorsteuer.
   * Beim innergemeinschaftlichen Erwerb (ig_erwerb) ebenso, auf die Konten der Erwerbsteuer und Erwerbsvorsteuer.
   */
  reverseCharge: SelfAssessedTax | null = null,
  /**
   * Gutschrift erstattet bereits Bezahltes (#786): Die Vorsteuerminderung wird nicht im Belegmonat gezogen, sondern erst
   * mit der Erstattung, Verrechnung oder Ausbuchung (§ 17 Abs. 1 Satz 2 und 8 UStG), und steht bis dahin auf dem
   * Zwischenkonto. Nur an Gutschriften (negativer Beleg); ohne die Angabe bleibt alles wie bisher.
   */
  erstattetBezahltes = false,
): PostingLine[] {
  // Privat genutzt ist bei einer GmbH keine Entnahme, sondern Arbeitslohn oder verdeckte Gewinnausschüttung
  if (privateShare !== 0 && isKapitalgesellschaft(rechtsform)) throw new RangeError("Privatanteil gibt es nur im Einzelunternehmen");
  const accounts = ACCOUNTS[kontenrahmen];
  if (erstattetBezahltes) {
    if (totals.gross >= 0) throw new RangeError("„Erstattet bereits Bezahltes“ gibt es nur an einer Gutschrift, also an einem negativen Beleg");
    if (reverseCharge) throw new RangeError("„Erstattet bereits Bezahltes“ gibt es nicht bei § 13b oder innergemeinschaftlichem Erwerb");
    if (category === "einfuhrumsatzsteuer") throw new RangeError("„Erstattet bereits Bezahltes“ gibt es nicht beim Bescheid des Zolls");
  }
  if (category === "einfuhrumsatzsteuer")
    return einfuhrumsatzsteuerPosting(
      totals,
      kontenrahmen,
      rechtsform,
      payment,
      buchungsAnteil(vorsteuerAbzug, totals.taxes[0]?.vorsteuerAnteil) === 10_000,
      privateShare,
      reverseCharge,
    );
  const expense = account ?? EXPENSE_CATEGORIES[category][kontenrahmen];
  const lines: PostingLine[] = [];
  let privatePart = 0;
  for (const row of totals.taxes) {
    const result = documentRatePosting(row, { expense, kontenrahmen, vorsteuerAbzug, privateShare, reverseCharge, erstattetBezahltes });
    lines.push(...result.lines);
    privatePart += result.privatePart;
  }
  // Der private Teil ist eine Entnahme; privat bezahlt heben sich Einlage und Entnahme insoweit auf
  if (privatePart !== 0) lines.push(side(accounts.privatentnahmen, privatePart, true, null));
  const counter = payment === "privat" ? ownerAccount(kontenrahmen, rechtsform, "einlage") : payment === "kasse" ? accounts.kasse : accounts.verbindlichkeiten;
  lines.push(side(counter, totals.gross, false, null));
  return lines.filter((line) => line.debit !== 0 || line.credit !== 0);
}

/** Eine Satzzeile: Privatnutzung, wirtschaftlicher Abzug und selbst geschuldete Steuer bleiben getrennt. */
function documentRatePosting(
  row: InvoiceTotals["taxes"][number],
  options: {
    expense: string;
    kontenrahmen: Kontenrahmen;
    vorsteuerAbzug: boolean | BasisPoints;
    privateShare: number;
    reverseCharge: SelfAssessedTax | null;
    erstattetBezahltes: boolean;
  },
) {
  const { expense, kontenrahmen, vorsteuerAbzug, privateShare, reverseCharge, erstattetBezahltes } = options;
  const accounts = ACCOUNTS[kontenrahmen];
  const lines: PostingLine[] = [];
  let privatePart = 0;
  const baseSplit = splitPrivateShare(row.base, privateShare);
  const taxSplit = splitPrivateShare(row.tax, privateShare);
  if (reverseCharge && row.rate !== 0) {
    // § 13b und Erwerb: Die Bemessungsgrundlage zählt in Kz 46/84 bzw. 89/93 voll, auch der private Teil. Er steht
    // deshalb mit dem Steuerschlüssel auf den Entnahmen, damit das Journal die ganze Bemessungsgrundlage trägt (#542).
    const code = reverseCharge === "ig_erwerb" ? IG_ERWERB.code[vatRate(row.rate)] : REVERSE_CHARGE_IN[reverseCharge].code;
    if (baseSplit.private !== 0) lines.push(side(accounts.privatentnahmen, baseSplit.private, true, code));
    privatePart += taxSplit.private;
  } else privatePart += baseSplit.private + taxSplit.private;
  const { rate } = row;
  const base = baseSplit.business;
  const tax = taxSplit.business;
  const anteil = buchungsAnteil(vorsteuerAbzug, row.vorsteuerAnteil);
  const deductible = abziehbareSteuer(tax, anteil);
  if (reverseCharge) {
    const ige = reverseCharge === "ig_erwerb";
    if (rate === 0) throw new RangeError(`${ige ? "Innergemeinschaftlicher Erwerb" : "§ 13b"}: Steuersatz muss 19 % oder 7 % sein`);
    const code = ige ? IG_ERWERB.code[vatRate(rate)] : REVERSE_CHARGE_IN[reverseCharge].code;
    if (base !== 0) lines.push(side(expense, base, true, code));
    if (tax - deductible !== 0) lines.push(side(expense, tax - deductible, true, "keineVSt"));
    if (deductible !== 0)
      lines.push(ige ? side(accounts.vorsteuerIge[vatRate(rate)], deductible, true, "VStIGE") : side(accounts.vorsteuerRc, deductible, true, "VSt13b"));
    if (row.tax !== 0) lines.push(side(ige ? accounts.ustIge[vatRate(rate)] : accounts.ustRc, row.tax, false, code));
    return { lines, privatePart };
  }
  if (anteil === 0) {
    if (base + tax !== 0) lines.push(side(expense, base + tax, true, "keineVSt"));
    return { lines, privatePart };
  }
  const code = inputTaxCode(rate);
  if (base !== 0) lines.push(side(expense, base, true, code));
  if (tax - deductible !== 0) lines.push(side(expense, tax - deductible, true, "keineVSt"));
  if (deductible !== 0) {
    // Mit der Angabe bleibt die Vorsteuerminderung auf dem Zwischenkonto, mit Steuerschlüssel und Bemessungsgrundlage
    const konto = erstattetBezahltes ? accounts.vorsteuerNochNichtAbziehbar : accounts.vorsteuer[vatRate(rate)];
    lines.push(side(konto, deductible, true, code));
  }
  return { lines, privatePart };
}

/**
 * Was einem Beleg „Einfuhrumsatzsteuer“ fehlt: Der Bescheid des Zolls enthält nur die Steuer, als ein Betrag ohne
 * Steuersatz (0 %, ohne Steuer im Betrag), abziehbar nur mit Vorsteuerabzug und ohne Privatanteil oder § 13b. Leer = buchbar.
 */
export function einfuhrumsatzsteuerIssues(
  totals: Pick<InvoiceTotals, "taxes">,
  vorsteuerAbzug: boolean,
  privateShare: number,
  reverseCharge: SelfAssessedTax | null,
): string[] {
  const issues: string[] = [];
  if (totals.taxes.some((t) => t.rate !== 0 || t.tax !== 0)) issues.push("Die Einfuhrumsatzsteuer steht als ein Betrag zu 0 % im Beleg, ohne Steuer darauf");
  if (!vorsteuerAbzug) issues.push("Ohne Vorsteuerabzug gehört die Einfuhrumsatzsteuer zu den Kosten der Ware; buche sie mit deren Kategorie");
  if (privateShare !== 0) issues.push("Einen Privatanteil gibt es bei der Einfuhrumsatzsteuer nicht");
  if (reverseCharge) issues.push("Einfuhrumsatzsteuer ist weder § 13b noch innergemeinschaftlicher Erwerb");
  return issues;
}

/** Einfuhrumsatzsteuer an Verbindlichkeiten (Bank), Kasse oder Privateinlage; ohne Aufwand, Vorsteuer Kz 62 */
function einfuhrumsatzsteuerPosting(
  totals: InvoiceTotals,
  kontenrahmen: Kontenrahmen,
  rechtsform: Rechtsform,
  payment: DocumentPayment,
  vorsteuerAbzug: boolean,
  privateShare: number,
  reverseCharge: SelfAssessedTax | null,
): PostingLine[] {
  const issues = einfuhrumsatzsteuerIssues(totals, vorsteuerAbzug, privateShare, reverseCharge);
  if (issues.length > 0) throw new RangeError(issues.join(". "));
  const accounts = ACCOUNTS[kontenrahmen];
  const counter = payment === "privat" ? ownerAccount(kontenrahmen, rechtsform, "einlage") : payment === "kasse" ? accounts.kasse : accounts.verbindlichkeiten;
  return [side(EXPENSE_CATEGORIES.einfuhrumsatzsteuer[kontenrahmen], totals.gross, true, "EUSt"), side(counter, totals.gross, false, null)].filter(
    (line) => line.debit !== 0 || line.credit !== 0,
  );
}

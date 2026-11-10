import type { Kontenrahmen } from "../datev.ts";
import type { BuchhaltungsbutlerJoinedRow } from "./types.ts";
import { BuchhaltungsbutlerError } from "./types.ts";

type AccountKind = "erloes" | "aufwand" | "debitor" | "kreditor" | "anlage" | "bank" | null;

export interface DirectionMapping {
  direction: "einnahme" | "ausgabe";
  positive: boolean;
  categoryAccount: string;
  /** Konto, an dem die Richtung hängt: Erlös, Aufwand, Personenkonto, Anlage oder nur Geldkonten */
  basis: Exclude<AccountKind, null>;
  /**
   * Weder Einnahme noch Ausgabe: Geld zwischen Geldkonten (Geldtransit, Privat), Zahlung auf ein Personenkonto
   * ohne Erlös- oder Aufwandskonto. Die Einnahme oder Ausgabe steht in der Buchung auf dem Erlös- bzw. Aufwandskonto.
   */
  neutral: boolean;
}

function accountKind(account: string, skr: Kontenrahmen): AccountKind {
  if (!/^\d+$/.test(account)) return null;
  const value = Number(account);
  if (value >= 10000 && value <= 69999) return "debitor";
  if (value >= 70000 && value <= 99999) return "kreditor";
  if (value < 1000) return "anlage";
  if (value < 2000) return "bank";
  if (skr === "SKR03") {
    if (value >= 3000 && value <= 4999) return "aufwand";
    if (value >= 8000 && value <= 8999) return "erloes";
  } else {
    if (value >= 4000 && value <= 4999) return "erloes";
    if (value >= 5000 && value <= 6999) return "aufwand";
  }
  return null;
}

/**
 * Weitere Erträge und Aufwendungen außerhalb der Erlös- und Aufwandsklassen: SKR03 Klasse 2 (Abgrenzungskonten,
 * z. B. 2110 Zinsaufwand, 2650 Zinserträge), SKR04 Klasse 7 (z. B. 7310 Zinsaufwand, 7685 Kfz-Steuer)
 */
function isOtherIncomeOrExpense(account: string, skr: Kontenrahmen): boolean {
  if (!/^\d+$/.test(account)) return false;
  const value = Number(account);
  return skr === "SKR03" ? value >= 2000 && value <= 2999 : value >= 7000 && value <= 7999;
}

/** Richtung und Vorzeichen aus Soll und Haben, ohne sie aus dem PDF-Namen zu schätzen. */
export function directionOf(row: BuchhaltungsbutlerJoinedRow, skr: Kontenrahmen): DirectionMapping {
  const debit = accountKind(row.debitAccount, skr);
  const credit = accountKind(row.creditAccount, skr);
  const id = row.info.bookingId;
  if ((debit === "erloes" && credit === "aufwand") || (debit === "aufwand" && credit === "erloes")) {
    throw new BuchhaltungsbutlerError(`Buchung ${id}: Erlös- und Aufwandskonto in derselben Buchung; die Richtung ist nicht eindeutig.`);
  }
  if (debit === "erloes" || credit === "erloes") {
    return {
      direction: "einnahme",
      positive: credit === "erloes",
      categoryAccount: debit === "erloes" ? row.debitAccount : row.creditAccount,
      basis: "erloes",
      neutral: false,
    };
  }
  if (debit === "aufwand" || credit === "aufwand") {
    return {
      direction: "ausgabe",
      positive: debit === "aufwand",
      categoryAccount: debit === "aufwand" ? row.debitAccount : row.creditAccount,
      basis: "aufwand",
      neutral: false,
    };
  }
  // Vor den Personenkonten: Anlagekauf über ein Kreditorenkonto ist eine Ausgabe mit Vorsteuer, keine Zahlung
  if (debit === "anlage" || credit === "anlage") {
    const assetAccount = debit === "anlage" ? row.debitAccount : row.creditAccount;
    const asset = { positive: true, categoryAccount: assetAccount, basis: "anlage" as const, neutral: false };
    if (debit === "bank") return { direction: "einnahme", ...asset };
    if (credit === "bank") return { direction: "ausgabe", ...asset };
    return { direction: debit === "anlage" ? "ausgabe" : "einnahme", ...asset };
  }
  if (debit === "debitor" || credit === "debitor") {
    return {
      direction: "einnahme",
      positive: credit === "debitor",
      categoryAccount: debit === "debitor" ? row.debitAccount : row.creditAccount,
      basis: "debitor",
      neutral: true,
    };
  }
  if (debit === "kreditor" || credit === "kreditor") {
    return {
      direction: "ausgabe",
      positive: debit === "kreditor",
      categoryAccount: debit === "kreditor" ? row.debitAccount : row.creditAccount,
      basis: "kreditor",
      neutral: true,
    };
  }
  if (debit === "bank" || credit === "bank") {
    const other = debit === "bank" ? row.creditAccount : row.debitAccount;
    return {
      direction: debit === "bank" ? "einnahme" : "ausgabe",
      positive: true,
      categoryAccount: other,
      basis: "bank",
      // Einnahme oder Ausgabe nur mit weiteren Erträgen und Aufwendungen; Geldtransit, Privat, Kapital, Steuerzahlungen
      // und Darlehen (Geld-, Eigenkapital- und Verbindlichkeitskonten) sind neutral
      neutral: !isOtherIncomeOrExpense(other, skr),
    };
  }
  throw new BuchhaltungsbutlerError(
    `Buchung ${id}: Richtung aus ${row.debitAccount} an ${row.creditAccount} nicht eindeutig (${skr}). Bitte den Export prüfen.`,
  );
}

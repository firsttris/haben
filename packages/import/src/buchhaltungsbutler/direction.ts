import type { Kontenrahmen } from "../datev.ts";
import type { BuchhaltungsbutlerJoinedRow } from "./types.ts";
import { BuchhaltungsbutlerError } from "./types.ts";

type AccountKind = "erloes" | "aufwand" | "debitor" | "kreditor" | "anlage" | "bank" | null;

export interface DirectionMapping {
  direction: "einnahme" | "ausgabe";
  positive: boolean;
  categoryAccount: string;
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

/** Richtung und Vorzeichen aus Soll und Haben, ohne sie aus dem PDF-Namen zu schätzen. */
export function directionOf(row: BuchhaltungsbutlerJoinedRow, skr: Kontenrahmen): DirectionMapping {
  const debit = accountKind(row.debitAccount, skr);
  const credit = accountKind(row.creditAccount, skr);
  const id = row.info.bookingId;
  if ((debit === "erloes" && credit === "aufwand") || (debit === "aufwand" && credit === "erloes")) {
    throw new BuchhaltungsbutlerError(`Buchung ${id}: Erlös- und Aufwandskonto in derselben Buchung; die Richtung ist nicht eindeutig.`);
  }
  if (debit === "erloes" || credit === "erloes") {
    return { direction: "einnahme", positive: credit === "erloes", categoryAccount: debit === "erloes" ? row.debitAccount : row.creditAccount };
  }
  if (debit === "aufwand" || credit === "aufwand") {
    return { direction: "ausgabe", positive: debit === "aufwand", categoryAccount: debit === "aufwand" ? row.debitAccount : row.creditAccount };
  }
  if (debit === "debitor" || credit === "debitor") {
    return { direction: "einnahme", positive: credit === "debitor", categoryAccount: debit === "debitor" ? row.debitAccount : row.creditAccount };
  }
  if (debit === "kreditor" || credit === "kreditor") {
    return { direction: "ausgabe", positive: debit === "kreditor", categoryAccount: debit === "kreditor" ? row.debitAccount : row.creditAccount };
  }
  if (debit === "anlage" || credit === "anlage") {
    const assetAccount = debit === "anlage" ? row.debitAccount : row.creditAccount;
    if (debit === "bank") return { direction: "einnahme", positive: true, categoryAccount: assetAccount };
    if (credit === "bank") return { direction: "ausgabe", positive: true, categoryAccount: assetAccount };
    return { direction: debit === "anlage" ? "ausgabe" : "einnahme", positive: true, categoryAccount: assetAccount };
  }
  if (debit === "bank" || credit === "bank") {
    return {
      direction: debit === "bank" ? "einnahme" : "ausgabe",
      positive: true,
      categoryAccount: debit === "bank" ? row.creditAccount : row.debitAccount,
    };
  }
  throw new BuchhaltungsbutlerError(
    `Buchung ${id}: Richtung aus ${row.debitAccount} an ${row.creditAccount} nicht eindeutig (${skr}). Bitte den Export prüfen.`,
  );
}

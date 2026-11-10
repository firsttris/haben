import { postenOf } from "@haben/core";
import type { Kontenrahmen } from "../datev.ts";
import type { BuchhaltungsbutlerJoinedRow } from "./types.ts";
import { BuchhaltungsbutlerError } from "./types.ts";

type AccountKind = "erloes" | "aufwand" | "debitor" | "kreditor" | "anlage" | "bank" | null;

export interface DirectionMapping {
  direction: "einnahme" | "ausgabe";
  positive: boolean;
  categoryAccount: string;
  /**
   * Weder Einnahme noch Ausgabe: Geld zwischen Geldkonten (Geldtransit, Privat), Zahlung auf ein Personenkonto
   * ohne Erlös- oder Aufwandskonto. Die Einnahme oder Ausgabe steht in der Buchung auf dem Erlös- bzw. Aufwandskonto.
   */
  neutral: boolean;
}

/**
 * Art eines Kontos nach den Posten des DATEV-Kontenrahmens 2026 (`postenOf`, SKR03 Art.-Nr. 11174, SKR04 Art.-Nr. 11175):
 * GuV-Erträge sind Erlöse, GuV-Aufwendungen und Steuern Aufwand, Anlagevermögen Anlage, alle übrigen Bilanzkonten (Geld,
 * Forderungen, Umsatz- und Vorsteuer, Privat, Kapital, Verbindlichkeiten, Rückstellungen) Geldkonten im Sinne der
 * Richtung. Personenkonten (fünfstellig und länger) nach den DATEV-Nummernkreisen.
 */
function accountKind(account: string, skr: Kontenrahmen): AccountKind {
  if (!/^\d+$/.test(account)) return null;
  const value = Number(account);
  if (account.length > 4) {
    if (value >= 10000 && value <= 69999) return "debitor";
    if (value >= 70000 && value <= 99999) return "kreditor";
    return null;
  }
  const posten = postenOf(skr, account.padStart(4, "0"));
  if (posten === null) return null;
  if (posten === "umsatzerloese" || posten === "sonstigeErtraege") return "erloes";
  if (posten === "aktiva.A") return "anlage";
  if (posten.startsWith("aktiva.") || posten.startsWith("passiva.")) return "bank";
  return "aufwand";
}

/**
 * Mit Steuerschlüssel legt DATEV die Steuerart selbst fest: BU 2 und 3 Umsatzsteuer, 8 und 9 Vorsteuer (DATEV,
 * Steuerschlüssel im Buchungsstapel). Das gilt auch für Konten, deren GuV-Posten die Richtung nicht zeigt, etwa Erlöse aus
 * Anlagenverkäufen bei Buchverlust (SKR03 8800 ff., unter den sonstigen Aufwendungen) oder Wareneinkauf auf ein
 * Bestandskonto (SKR03 3970 ff.). Das Sachkonto ist die Seite, die kein Geld- oder Personenkonto ist.
 */
function directionOfTaxKey(row: BuchhaltungsbutlerJoinedRow, debit: AccountKind, credit: AccountKind): DirectionMapping | null {
  const bu = row.datev.buKey.trim().replace(/^0+/, "");
  const direction = bu === "2" || bu === "3" ? "einnahme" : bu === "8" || bu === "9" ? "ausgabe" : null;
  if (!direction) return null;
  // Gegen ein Personenkonto ist die andere Seite das Sachkonto, auch ein Bestandskonto; sonst die Seite ohne Geldkonto
  const person = (kind: AccountKind) => kind === "debitor" || kind === "kreditor";
  const money = (kind: AccountKind) => person(kind) || kind === "bank";
  let onDebit: boolean;
  if (person(debit) !== person(credit)) onDebit = person(credit);
  else if (money(debit) !== money(credit)) onDebit = money(credit);
  else return null;
  return {
    direction,
    positive: direction === "einnahme" ? !onDebit : onDebit,
    categoryAccount: onDebit ? row.debitAccount : row.creditAccount,
    neutral: false,
  };
}

/** Richtung und Vorzeichen aus Soll und Haben, ohne sie aus dem PDF-Namen zu schätzen. */
export function directionOf(row: BuchhaltungsbutlerJoinedRow, skr: Kontenrahmen): DirectionMapping {
  const debit = accountKind(row.debitAccount, skr);
  const credit = accountKind(row.creditAccount, skr);
  const id = row.info.bookingId;
  const byTaxKey = directionOfTaxKey(row, debit, credit);
  if (byTaxKey) return byTaxKey;
  if ((debit === "erloes" && credit === "aufwand") || (debit === "aufwand" && credit === "erloes")) {
    throw new BuchhaltungsbutlerError(`Buchung ${id}: Erlös- und Aufwandskonto in derselben Buchung; die Richtung ist nicht eindeutig.`);
  }
  if (debit === "erloes" || credit === "erloes") {
    return {
      direction: "einnahme",
      positive: credit === "erloes",
      categoryAccount: debit === "erloes" ? row.debitAccount : row.creditAccount,
      neutral: false,
    };
  }
  if (debit === "aufwand" || credit === "aufwand") {
    return {
      direction: "ausgabe",
      positive: debit === "aufwand",
      categoryAccount: debit === "aufwand" ? row.debitAccount : row.creditAccount,
      neutral: false,
    };
  }
  // Vor den Personenkonten: Anlagekauf über ein Kreditorenkonto ist eine Ausgabe mit Vorsteuer, keine Zahlung
  if (debit === "anlage" || credit === "anlage") {
    const assetAccount = debit === "anlage" ? row.debitAccount : row.creditAccount;
    const asset = { positive: true, categoryAccount: assetAccount, neutral: false };
    if (debit === "bank") return { direction: "einnahme", ...asset };
    if (credit === "bank") return { direction: "ausgabe", ...asset };
    return { direction: debit === "anlage" ? "ausgabe" : "einnahme", ...asset };
  }
  if (debit === "debitor" || credit === "debitor") {
    return {
      direction: "einnahme",
      positive: credit === "debitor",
      categoryAccount: debit === "debitor" ? row.debitAccount : row.creditAccount,
      neutral: true,
    };
  }
  if (debit === "kreditor" || credit === "kreditor") {
    return {
      direction: "ausgabe",
      positive: debit === "kreditor",
      categoryAccount: debit === "kreditor" ? row.debitAccount : row.creditAccount,
      neutral: true,
    };
  }
  if (debit === "bank" || credit === "bank") {
    // Nur Bilanzkonten ohne Anlagevermögen: Geldtransit, Privat, Kapital, Steuerzahlungen, Darlehen
    return {
      direction: debit === "bank" ? "einnahme" : "ausgabe",
      positive: true,
      categoryAccount: debit === "bank" ? row.creditAccount : row.debitAccount,
      neutral: true,
    };
  }
  throw new BuchhaltungsbutlerError(
    `Buchung ${id}: Richtung aus ${row.debitAccount} an ${row.creditAccount} nicht eindeutig (${skr}). Bitte den Export prüfen.`,
  );
}

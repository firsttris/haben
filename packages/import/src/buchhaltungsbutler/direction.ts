import { KAPG_STEUER_KONTEN, postenOf } from "@haben/core";
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

/** Steuern vom Einkommen und Ertrag samt Vorjahren und Solidaritätszuschlag (§ 10 Nr. 2 KStG, § 4 Abs. 5b EStG) */
export function isErtragsteuerKonto(account: string, skr: Kontenrahmen): boolean {
  const k = KAPG_STEUER_KONTEN[skr];
  return [k.kst, k.soli, k.gewst, k.kstVorjahre, k.soliWeitere, k.gewstVorjahre].some((list) => (list as readonly string[]).includes(account));
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
    // Nur Bilanzkonten ohne Anlagevermögen: Geldtransit, Privat, Kapital, Steuerzahlungen, Darlehen
    return {
      direction: debit === "bank" ? "einnahme" : "ausgabe",
      positive: true,
      categoryAccount: debit === "bank" ? row.creditAccount : row.debitAccount,
      basis: "bank",
      neutral: true,
    };
  }
  throw new BuchhaltungsbutlerError(
    `Buchung ${id}: Richtung aus ${row.debitAccount} an ${row.creditAccount} nicht eindeutig (${skr}). Bitte den Export prüfen.`,
  );
}

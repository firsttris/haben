import type { Cents } from "./money.ts";
import { kontoart } from "./ledger.ts";
import type { Kontenrahmen } from "./posting.ts";

/**
 * Saldenvortrag zum Jahresbeginn (Bilanzierung, GmbH und UG): Bestandskonten tragen ihren Saldo ins neue Jahr, Erfolgskonten
 * beginnen bei null. Ihr Ergebnis aus den Vorjahren steht als Gewinn- bzw. Verlustvortrag vor Verwendung im Eigenkapital,
 * bis es mit einer Buchung verwendet wird (Ausschüttung, Rücklage). So bleibt die Summe aller Vorträge null wie im Journal.
 */
export const VORTRAG_ACCOUNTS: Record<Kontenrahmen, { gewinn: string; verlust: string }> = {
  // SKR03 0860/0868: nicht in odoo l10n_de (dort nur 0865/0867 der Personengesellschaften); gegen DATEV noch zu prüfen
  SKR03: { gewinn: "0860", verlust: "0868" },
  // SKR04 2970/2978 „Gewinnvortrag/Verlustvortrag vor Verwendung“ (DATEV, gegengelesen mit odoo l10n_de)
  SKR04: { gewinn: "2970", verlust: "2978" },
};

/** Trägt das Konto seinen Saldo ins nächste Jahr? Bestandskonten und die Vortragskonten der Klasse 9 ja, Erlöse und Aufwand nein */
export function carriesForward(kontenrahmen: Kontenrahmen, account: string): boolean {
  return account.startsWith("9") || kontoart(kontenrahmen, account) === "bestand";
}

export interface KontoSaldo {
  account: string;
  /** Soll − Haben */
  saldo: Cents;
}

/**
 * Vorträge aus den Salden aller Vorjahre: Bestandskonten wie sie sind, die Erfolgskonten zusammen als Ergebnis auf dem
 * Gewinnvortrag (Saldo im Haben) bzw. Verlustvortrag (im Soll). Konten mit Vortrag 0 fehlen.
 */
export function carryForward(kontenrahmen: Kontenrahmen, prior: readonly KontoSaldo[]): Map<string, Cents> {
  const result = new Map<string, Cents>();
  const add = (account: string, saldo: Cents) => result.set(account, (result.get(account) ?? 0) + saldo);
  let ergebnis = 0;
  for (const { account, saldo } of prior) {
    if (carriesForward(kontenrahmen, account)) add(account, saldo);
    else ergebnis += saldo;
  }
  if (ergebnis !== 0) add(ergebnis < 0 ? VORTRAG_ACCOUNTS[kontenrahmen].gewinn : VORTRAG_ACCOUNTS[kontenrahmen].verlust, ergebnis);
  for (const [account, saldo] of result) if (saldo === 0) result.delete(account);
  return result;
}

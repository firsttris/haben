import { ACCOUNTS, postenOf } from "@haben/core";
import { AUTOMATIC, BU_RATES, datevAccountKind, isPersonenkonto, shortAccount, type DatevBooking, type Kontenrahmen } from "./datev.ts";

/*
 * Salden je Sachkonto aus einem DATEV-Buchungsstapel, so wie Haben sie selbst gebucht hätte: damit lassen sich Bilanz, GuV
 * und die Steuern einer GmbH aus dem Altbestand mit denselben Funktionen rechnen wie aus dem eigenen Journal.
 */

export type DatevSaldenBooking = Pick<DatevBooking, "amount" | "side" | "account" | "contraAccount" | "buKey"> & {
  /** Sachkontenlänge aus der Kopfzeile des Stapels; fehlt sie oder ist 0, gilt 4 */
  accountLength?: number | null;
};

export interface DatevSaldo {
  account: string;
  /** Soll − Haben in Cent */
  saldo: number;
}

/**
 * Personenkonten auf das Sammelkonto: Debitoren (erste Ziffer 1 bis 6) auf Forderungen, Kreditoren (7 bis 9) auf
 * Verbindlichkeiten aus Lieferungen und Leistungen, nach der Nummernvergabe der DATEV-Format-Beschreibung.
 * Sachkonten mit mehr als vier Stellen (84000) auf die Kontonummer gekürzt.
 */
function sachkonto(kontenrahmen: Kontenrahmen, account: string, accountLength: number): string {
  if (isPersonenkonto(account, accountLength)) {
    return Number(account[0]) <= 6 ? ACCOUNTS[kontenrahmen].forderungen : ACCOUNTS[kontenrahmen].verbindlichkeiten;
  }
  return /^\d+$/.test(account) ? shortAccount(account) : account;
}

/** Steuerkonto für den Steueranteil einer brutto gebuchten Zeile, oder null, wenn der Satz kein Konto hat */
function steuerkonto(kontenrahmen: Kontenrahmen, art: "ust" | "vorsteuer", rate: number): string | null {
  const key = rate === 19 ? 1900 : rate === 7 ? 700 : null;
  return key === null ? null : ACCOUNTS[kontenrahmen][art][key];
}

/** BU-Schlüssel 2 und 3 sind Umsatzsteuer, 8 und 9 Vorsteuer */
const BU_ART: Record<string, "ust" | "vorsteuer"> = { "2": "ust", "3": "ust", "8": "vorsteuer", "9": "vorsteuer" };

/**
 * Steuer einer Seite: Erlös- und Aufwandskonten über Automatik oder BU-Schlüssel, Anlagevermögen (Kauf, Verkauf) nur über den
 * BU-Schlüssel; alle anderen Konten tragen den Betrag, wie er gebucht ist.
 */
function steuerAnteil(
  kontenrahmen: Kontenrahmen,
  account: string,
  accountLength: number,
  konto: string,
  buKey: string,
): { rate: number; konto: string } | null {
  if (buKey === "40") return null;
  const kind = datevAccountKind(kontenrahmen, account, accountLength);
  if (kind === "erloese" || kind === "aufwand") {
    const rate = BU_RATES[buKey] ?? AUTOMATIC[kontenrahmen][konto] ?? 0;
    const taxAccount = steuerkonto(kontenrahmen, kind === "erloese" ? "ust" : "vorsteuer", rate);
    return taxAccount ? { rate, konto: taxAccount } : null;
  }
  const art = BU_ART[buKey];
  if (!art || isPersonenkonto(account, accountLength) || postenOf(kontenrahmen, konto) !== "aktiva.A") return null;
  const taxAccount = steuerkonto(kontenrahmen, art, BU_RATES[buKey]!);
  return taxAccount ? { rate: BU_RATES[buKey]!, konto: taxAccount } : null;
}

/**
 * Salden je Sachkonto (Soll − Haben). Wo eine Steuerautomatik oder ein BU-Schlüssel (2, 3, 8, 9) greift, ist der Betrag
 * brutto gebucht; der Steueranteil geht dann wie in DATEV auf das Umsatz- bzw. Vorsteuerkonto, das Erlös- bzw.
 * Aufwandskonto behält den Nettobetrag. BU-Schlüssel 40 hebt die Automatik auf. Dieselben Regeln wie in datevYearSums;
 * zusätzlich teilt ein BU-Schlüssel auch beim Anlagevermögen die Steuer ab, sonst stünde eine Anlage brutto in der Bilanz.
 */
export function datevSalden(bookings: readonly DatevSaldenBooking[], kontenrahmen: Kontenrahmen): DatevSaldo[] {
  const salden = new Map<string, number>();
  const add = (account: string, amount: number) => salden.set(account, (salden.get(account) ?? 0) + amount);
  for (const b of bookings) {
    const accountLength = b.accountLength || 4;
    const buKey = b.buKey.trim().replace(/^0+/, "");
    const [debit, credit] = b.side === "S" ? [b.account, b.contraAccount] : [b.contraAccount, b.account];
    for (const [account, sign] of [
      [debit, 1],
      [credit, -1],
    ] as const) {
      const konto = sachkonto(kontenrahmen, account, accountLength);
      const steuer = steuerAnteil(kontenrahmen, account, accountLength, konto, buKey);
      const tax = steuer ? Math.round((b.amount * steuer.rate) / (100 + steuer.rate)) : 0;
      add(konto, sign * (b.amount - tax));
      if (steuer) add(steuer.konto, sign * tax);
    }
  }
  return [...salden]
    .filter(([, saldo]) => saldo !== 0)
    .map(([account, saldo]) => ({ account, saldo }))
    .sort((a, b) => a.account.localeCompare(b.account, "de", { numeric: true }));
}

/** Saldenvortragskonten 9000 bis 9009: Stehen sie im Stapel eines Jahres, bringt er seine Eröffnungsbilanz selbst mit */
export function hasOpeningBalances(bookings: readonly DatevSaldenBooking[]): boolean {
  // Bei Sachkontenlänge 5 heißen sie 90000 bis 90090; gekürzt wie in datevSalden
  const isVortrag = (account: string, accountLength: number) => !isPersonenkonto(account, accountLength) && /^900\d$/.test(shortAccount(account));
  return bookings.some((b) => isVortrag(b.account, b.accountLength || 4) || isVortrag(b.contraAccount, b.accountLength || 4));
}

import { ACCOUNTS } from "@haben/core";
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
function steuerkonto(kontenrahmen: Kontenrahmen, kind: "erloese" | "aufwand", rate: number): string | null {
  const key = rate === 19 ? 1900 : rate === 7 ? 700 : null;
  if (key === null) return null;
  return (kind === "erloese" ? ACCOUNTS[kontenrahmen].ust : ACCOUNTS[kontenrahmen].vorsteuer)[key];
}

/**
 * Salden je Sachkonto (Soll − Haben). Wo eine Steuerautomatik oder ein BU-Schlüssel (2, 3, 8, 9) greift, ist der Betrag
 * brutto gebucht; der Steueranteil geht dann wie in DATEV auf das Umsatz- bzw. Vorsteuerkonto, das Erlös- bzw.
 * Aufwandskonto behält den Nettobetrag. BU-Schlüssel 40 hebt die Automatik auf. Dieselben Regeln wie in datevYearSums.
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
      const kind = datevAccountKind(kontenrahmen, account, accountLength);
      const rate = kind === "erloese" || kind === "aufwand" ? (buKey === "40" ? 0 : (BU_RATES[buKey] ?? AUTOMATIC[kontenrahmen][konto] ?? 0)) : 0;
      const taxAccount = rate > 0 && (kind === "erloese" || kind === "aufwand") ? steuerkonto(kontenrahmen, kind, rate) : null;
      const tax = taxAccount ? Math.round((b.amount * rate) / (100 + rate)) : 0;
      add(konto, sign * (b.amount - tax));
      if (taxAccount) add(taxAccount, sign * tax);
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

import type { Cents } from "@haben/core";
import type { DatevBooking } from "./datev.ts";

/* Kontenbereiche der DATEV-Standardkontenrahmen und die Jahressummen eines Buchungsstapels (datev.ts liest ihn) */

export type Kontenrahmen = "SKR03" | "SKR04";

/** Kontenbereiche der DATEV-Standardkontenrahmen für die Jahressummen; Grenzen jeweils einschließlich */
export const RANGES: Record<Kontenrahmen, { erloese: [number, number][]; aufwand: [number, number][]; ust: [number, number][]; vst: [number, number][] }> = {
  // SKR03: Klasse 8 Erlöse, Klassen 3 und 4 Wareneingang und betriebliche Aufwendungen
  SKR03: { erloese: [[8000, 8999]], aufwand: [[3000, 4999]], ust: [[1770, 1779]], vst: [[1570, 1579]] },
  // SKR04: Klasse 4 Erlöse, Klassen 5 und 6 Material und betriebliche Aufwendungen
  SKR04: { erloese: [[4000, 4999]], aufwand: [[5000, 6999]], ust: [[3800, 3809]], vst: [[1400, 1409]] },
};

/** Konten mit Steuerautomatik (Beträge brutto), Steuersatz in Prozent */
export const AUTOMATIC: Record<Kontenrahmen, Record<string, number>> = {
  SKR03: { "8400": 19, "8300": 7, "3400": 19, "3300": 7 },
  SKR04: { "4400": 19, "4300": 7, "5400": 19, "5300": 7 },
};

/** BU-Schlüssel mit Steuersatz in Prozent (2/3 Umsatzsteuer, 8/9 Vorsteuer) */
export const BU_RATES: Record<string, number> = { "2": 7, "3": 19, "8": 7, "9": 19 };

/** Sachkonten mit mehr als vier Stellen (z. B. 84000) auf die Kontonummer gekürzt */
export const shortAccount = (account: string) => (account.length > 4 ? account.slice(0, 4) : account);

/** Personenkonto: numerisch und länger als die Sachkontenlänge aus der Kopfzeile (Debitor oder Kreditor) */
export const isPersonenkonto = (account: string, accountLength: number) => /^\d+$/.test(account) && account.length > accountLength;

/** Erlös-, Aufwands-, Umsatzsteuer- oder Vorsteuerkonto nach den Kontenbereichen; Personenkonten und alles andere null */
export function datevAccountKind(kontenrahmen: Kontenrahmen, account: string, accountLength: number): keyof (typeof RANGES)[Kontenrahmen] | null {
  if (!/^\d+$/.test(account) || isPersonenkonto(account, accountLength)) return null;
  const n = Number(shortAccount(account));
  const ranges = RANGES[kontenrahmen];
  for (const k of ["erloese", "aufwand", "ust", "vst"] as const) {
    if (ranges[k].some(([from, to]) => n >= from && n <= to)) return k;
  }
  return null;
}

export interface DatevYearSums {
  einnahmen: { net: Cents; tax: Cents };
  ausgaben: { net: Cents; tax: Cents };
}

/**
 * Einnahmen, Ausgaben, Umsatz- und Vorsteuer aus einem Buchungsstapel, zum Abgleich, wenn keine Belege per API
 * vorliegen. Erlöse und Aufwand nach Kontenklasse; Steuer aus Automatikkonten und BU-Schlüssel 2, 3, 8, 9
 * (brutto gebucht) oder aus Buchungen auf den Steuerkonten. BU-Schlüssel 40 hebt die Automatik auf.
 * Eine Näherung: Sonderfälle wie § 13b oder innergemeinschaftliche Erwerbe stehen nur über die Steuerkonten drin.
 */
export function datevYearSums(
  /** accountLength: Sachkontenlänge aus der Kopfzeile des Stapels; fehlt sie oder ist 0, gilt 4 */
  bookings: (Pick<DatevBooking, "amount" | "side" | "account" | "contraAccount" | "buKey"> & { accountLength?: number | null })[],
  kontenrahmen: Kontenrahmen,
): DatevYearSums {
  const automatic = AUTOMATIC[kontenrahmen];
  const kind = (account: string, accountLength: number) => datevAccountKind(kontenrahmen, account, accountLength);
  const sums: DatevYearSums = { einnahmen: { net: 0, tax: 0 }, ausgaben: { net: 0, tax: 0 } };
  for (const b of bookings) {
    const [debit, credit] = b.side === "S" ? [b.account, b.contraAccount] : [b.contraAccount, b.account];
    const buKey = b.buKey.trim().replace(/^0+/, "");
    const accountLength = b.accountLength || 4;
    for (const [account, onDebit] of [
      [debit, true],
      [credit, false],
    ] as const) {
      const k = kind(account, accountLength);
      if (!k) continue;
      if (k === "ust" || k === "vst") {
        const sign = (k === "vst") === onDebit ? 1 : -1;
        (k === "ust" ? sums.einnahmen : sums.ausgaben).tax += sign * b.amount;
        continue;
      }
      const target = k === "erloese" ? sums.einnahmen : sums.ausgaben;
      const sign = (k === "aufwand") === onDebit ? 1 : -1;
      const rate = buKey === "40" ? 0 : (BU_RATES[buKey] ?? automatic[shortAccount(account)] ?? 0);
      const tax = rate === 0 ? 0 : Math.round((b.amount * rate) / (100 + rate));
      target.net += sign * (b.amount - tax);
      target.tax += sign * tax;
    }
  }
  return sums;
}

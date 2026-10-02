import { taxOf, type Cents } from "./money.ts";
import { ACCOUNTS, type Kontenrahmen, type PostingLine } from "./posting.ts";

/**
 * Private Nutzung eines Firmenwagens nach der Listenpreismethode (§ 6 Abs. 1 Nr. 4 Satz 2 EStG):
 * je Monat ein Prozentsatz des inländischen Bruttolistenpreises bei Erstzulassung, abgerundet auf
 * volle 100 €. Der Satz hängt am Antrieb: 1 % (Verbrenner), 0,5 % (begünstigter Plug-in-Hybrid,
 * Elektro über der Preisgrenze), 0,25 % (Elektro bis zur Preisgrenze).
 *
 * Umsatzsteuer: unentgeltliche Wertabgabe (§ 3 Abs. 9a UStG). Bemessung ist 1 % des vollen
 * Listenpreises abzüglich 20 % für Kosten ohne Vorsteuer, auch bei Elektro- und Hybridautos;
 * die Ermäßigung gilt nur für die Einkommensteuer.
 */
export const CAR_DRIVES = {
  verbrenner: "Verbrenner",
  hybrid: "Plug-in-Hybrid (begünstigt)",
  elektro: "Elektro",
} as const;

export type CarDrive = keyof typeof CAR_DRIVES;
export const CAR_DRIVE_KEYS = Object.keys(CAR_DRIVES) as [CarDrive, ...CarDrive[]];

/** Monatlicher Satz in Hundertstel Prozent: 100 = 1 %, 50 = 0,5 %, 25 = 0,25 % */
export type PrivateUseRate = 100 | 50 | 25;
export const PRIVATE_USE_RATES: PrivateUseRate[] = [100, 50, 25];

export interface CarPrivateUse {
  /** Bruttolistenpreis inklusive Sonderausstattung und Umsatzsteuer, in Cent */
  listPrice: Cents;
  drive: CarDrive;
  rate: PrivateUseRate;
  /** Umsatzsteuer auf die Privatnutzung (aus, wenn beim Kauf keine Vorsteuer gezogen wurde oder bei Kleinunternehmern) */
  vat: boolean;
}

/** Preisgrenze für 0,25 % bei Elektroautos, nach Anschaffungsdatum */
export function electricPriceLimit(acquisitionDate: string): Cents {
  if (acquisitionDate < "2024-01-01") return 6_000_000;
  if (acquisitionDate < "2025-07-01") return 7_000_000;
  return 10_000_000;
}

/** Vorschlag für den Satz; begünstigt sind Elektro- und Hybridautos, die ab 2019 angeschafft wurden */
export function suggestedPrivateUseRate(drive: CarDrive, listPrice: Cents, acquisitionDate: string): PrivateUseRate {
  if (drive === "verbrenner" || acquisitionDate < "2019-01-01") return 100;
  if (drive === "hybrid") return 50;
  return listPrice <= electricPriceLimit(acquisitionDate) ? 25 : 50;
}

/** Listenpreis abgerundet auf volle 100 € */
export function roundedListPrice(listPrice: Cents): Cents {
  return Math.floor(listPrice / 10_000) * 10_000;
}

export interface PrivateUseMonth {
  /** Entnahme für die Einkommensteuer */
  withdrawal: Cents;
  /** Bemessungsgrundlage der Umsatzsteuer (Kz 81) */
  vatBase: Cents;
  vat: Cents;
}

export function privateUseMonth(use: CarPrivateUse): PrivateUseMonth {
  const price = roundedListPrice(use.listPrice);
  const withdrawal = Math.round((price * use.rate) / 10_000);
  // 1 % des Listenpreises abzüglich 20 % = 0,8 %
  const vatBase = use.vat ? Math.round((price * 8) / 1_000) : 0;
  return { withdrawal, vatBase, vat: taxOf(vatBase, 1900) };
}

/**
 * Monate eines Jahres (1–12), in denen die Pauschale anfällt: ab dem Monat der Anschaffung bzw. der
 * Übernahme bis einschließlich des Abgangsmonats. Angefangene Monate zählen voll.
 */
export function privateUseMonths(
  car: { acquisitionDate: string; openingDate?: string | null; disposalDate?: string | null },
  year: number,
): number[] {
  const startDate = car.openingDate && car.openingDate > car.acquisitionDate ? car.openingDate : car.acquisitionDate;
  const start = Number(startDate.slice(0, 4)) * 12 + Number(startDate.slice(5, 7)) - 1;
  const end = car.disposalDate ? Number(car.disposalDate.slice(0, 4)) * 12 + Number(car.disposalDate.slice(5, 7)) - 1 : Infinity;
  const months: number[] = [];
  for (let m = 1; m <= 12; m++) {
    const index = year * 12 + m - 1;
    if (index >= start && index <= end) months.push(m);
  }
  return months;
}

/** Erlöskonten der Kfz-Nutzung. Vor dem Echtbetrieb mit dem Steuerberater abgleichen. */
export const PRIVATE_USE_ACCOUNTS = {
  SKR03: { mitUst: "8921", ohneUst: "8924" },
  SKR04: { mitUst: "4645", ohneUst: "4639" },
} as const;

export const PRIVATE_USE_ACCOUNT_NAMES: Record<Kontenrahmen, Record<string, string>> = {
  SKR03: {
    "8921": "Verwendung von Gegenständen außerhalb des Unternehmens 19 % USt (Kfz-Nutzung)",
    "8924": "Verwendung von Gegenständen außerhalb des Unternehmens ohne USt (Kfz-Nutzung)",
  },
  SKR04: {
    "4645": "Verwendung von Gegenständen außerhalb des Unternehmens 19 % USt (Kfz-Nutzung)",
    "4639": "Verwendung von Gegenständen außerhalb des Unternehmens ohne USt (Kfz-Nutzung)",
  },
};


/**
 * Buchung eines Monats: Privatentnahmen an Erlöse aus Kfz-Nutzung (mit USt bis zur Höhe der
 * Bemessungsgrundlage, der Rest ohne USt) und Umsatzsteuer. Die Kennzahl 81 rechnet Haben aus der
 * Bemessungsgrundlage, nicht aus dem Erlöskonto, weil sie bei Elektroautos über der Entnahme liegt.
 */
export function privateUsePosting(month: PrivateUseMonth, kontenrahmen: Kontenrahmen): PostingLine[] {
  const accounts = ACCOUNTS[kontenrahmen];
  const revenue = PRIVATE_USE_ACCOUNTS[kontenrahmen];
  const withVat = Math.min(month.withdrawal, month.vatBase);
  const lines: PostingLine[] = [
    { account: accounts.privatentnahmen, debit: month.withdrawal + month.vat, credit: 0, taxCode: null },
    { account: revenue.mitUst, debit: 0, credit: withVat, taxCode: "USt19" },
    { account: revenue.ohneUst, debit: 0, credit: month.withdrawal - withVat, taxCode: null },
    { account: accounts.ust[1900], debit: 0, credit: month.vat, taxCode: "USt19" },
  ];
  return lines.filter((line) => line.debit !== 0 || line.credit !== 0);
}

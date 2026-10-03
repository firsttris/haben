/** Geldbeträge sind immer ganze Cent. */
export type Cents = number;

/** Steuersätze in Basispunkten: 1900 = 19 %. */
export type BasisPoints = number;

export function assertCents(value: number): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Kein ganzzahliger Centbetrag: ${value}`);
  }
  return value;
}

/** Steuer auf einen Nettobetrag, kaufmännisch gerundet. */
export function taxOf(net: Cents, rate: BasisPoints): Cents {
  const raw = (net * rate) / 10_000;
  return Math.sign(raw) * Math.round(Math.abs(raw));
}

const formatter = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 123456 → "1.234,56 €", mit geschütztem Leerzeichen, damit das € nie allein in die nächste Zeile rutscht */
export function formatEuro(cents: Cents): string {
  return `${formatter.format(cents / 100)}\u00a0€`;
}

/** 123456 → "1.234,56" */
export function formatDecimal(cents: Cents): string {
  return formatter.format(cents / 100);
}

/** Für CSV-Dateien: Dezimalkomma ohne Tausenderpunkt, 123456 → "1234,56", -5 → "-0,05" */
export function csvDecimal(cents: Cents): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Liest einen deutsch geschriebenen Betrag ("1.234,56", "-12,5", "1234") in Cent.
 * Gibt null zurück, wenn die Eingabe kein Betrag ist.
 */
export function parseEuro(input: string): Cents | null {
  const cleaned = input.replace(/\s|€/g, "").replace(/−/g, "-");
  if (!/^-?(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/.test(cleaned)) return null;
  const negative = cleaned.startsWith("-");
  const [whole = "0", fraction = ""] = cleaned.replace("-", "").replace(/\./g, "").split(",");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return negative ? -cents : cents;
}

/** Aufteilung eines Betrags nach Privatanteil in Prozent: privat wird gerundet, betrieblich ist der Rest */
export function splitPrivateShare(amount: Cents, percent: number): { business: Cents; private: Cents } {
  const privatePart = Math.round((amount * percent) / 100);
  return { business: amount - privatePart, private: privatePart };
}

import { formatDecimal, parseEuro, taxIncluded, taxOf, type Cents } from "@haben/core";

export type BetragsSatz = 1900 | 700 | 0;

/** Eine Zeile unter „Beträge je Steuersatz“ am Beleg; die Beträge als Text, wie eingetippt */
export interface Betragszeile {
  key: number;
  taxRate: BetragsSatz;
  net: string;
  tax: string;
  /** Brutto laut Beleg (#917); folgt Netto und Vorsteuer, solange es nicht selbst eingegeben wurde */
  gross: string;
  /** Vorsteuer von Hand geändert: kein Vorschlag mehr aus dem Netto */
  taxTouched: boolean;
  /** Zuletzt eingegeben: Netto oder Brutto. Ein anderer Satz rechnet vom zuletzt eingegebenen Betrag aus neu */
  basis: "net" | "gross";
}

/**
 * Bruttobetrag in Entgelt (Netto) und enthaltene Steuer aufteilen, wie es § 35 Abs. 1 UStDV für Kleinbetragsrechnungen
 * nach § 33 UStDV (bis 250 €, nur Endbetrag und Steuersatz) zum Vorsteuerabzug verlangt: 11,90 € zu 19 % → 10,00 + 1,90.
 * Kaufmännisch gerundet wie `taxIncluded`; die UStDV regelt die Rundung nicht, eine Abweichung zur Rechnung korrigiert man von Hand.
 */
export function bruttoZerlegen(gross: Cents, taxRate: BetragsSatz): { net: Cents; tax: Cents } {
  const tax = taxIncluded(gross, taxRate);
  return { net: gross - tax, tax };
}

/** Brutto leer oder als Betrag lesbar; ein unlesbares Brutto sperrt Speichern wie ein unlesbares Netto */
export function bruttoLesbar(row: Pick<Betragszeile, "gross">): boolean {
  return row.gross.trim() === "" || parseEuro(row.gross) !== null;
}

/** Brutto aus Netto und Vorsteuer als Text; leer, solange beides leer ist, unverändert, solange eins nicht lesbar ist */
function bruttoText(net: string, tax: string, bisher: string): string {
  if (!net.trim() && !tax.trim()) return "";
  const n = parseEuro(net || "0");
  const t = parseEuro(tax || "0");
  return n === null || t === null ? bisher : formatDecimal(n + t);
}

/** Zeile aus gespeicherten Beträgen in Cent */
export function betragszeileAus(key: number, taxRate: BetragsSatz, net: Cents, tax: Cents, leer: boolean, taxTouched: boolean): Betragszeile {
  return {
    key,
    taxRate,
    net: leer ? "" : formatDecimal(net),
    tax: leer ? "" : formatDecimal(tax),
    gross: leer ? "" : formatDecimal(net + tax),
    taxTouched,
    basis: "net",
  };
}

/**
 * Änderung an einer Zeile. Brutto eingegeben: Netto und Vorsteuer daraus. Netto oder Satz geändert: Vorsteuer vorschlagen,
 * solange sie nicht von Hand geändert wurde, bei selbst geschuldeter Steuer (§ 13b, ig. Erwerb) immer. Netto oder Vorsteuer
 * geändert: Brutto folgt. Bei selbst geschuldeter Steuer gibt es kein Brutto, gezahlt wird das Netto.
 */
export function aendereBetragszeile(row: Betragszeile, patch: Partial<Omit<Betragszeile, "key">>, selbstGeschuldet: boolean): Betragszeile {
  const next: Betragszeile = { ...row, ...patch };
  if ("gross" in patch && !selbstGeschuldet) {
    next.basis = "gross";
    return vonBrutto(next);
  }
  if ("net" in patch) next.basis = "net";
  if ("taxRate" in patch && next.basis === "gross" && !selbstGeschuldet) return vonBrutto(next);
  if ((selbstGeschuldet || !next.taxTouched) && ("net" in patch || "taxRate" in patch)) {
    const net = parseEuro(next.net || "0");
    if (net !== null) next.tax = formatDecimal(taxOf(net, next.taxRate));
  }
  if ("tax" in patch) next.basis = "net";
  next.gross = bruttoText(next.net, next.tax, next.gross);
  return next;
}

/** Netto und Vorsteuer aus dem Brutto; die Vorsteuer gilt dann wieder als vorgeschlagen */
function vonBrutto(row: Betragszeile): Betragszeile {
  if (!row.gross.trim()) return { ...row, net: "", tax: "", taxTouched: false };
  const gross = parseEuro(row.gross);
  if (gross === null) return row;
  const { net, tax } = bruttoZerlegen(gross, row.taxRate);
  return { ...row, net: formatDecimal(net), tax: formatDecimal(tax), taxTouched: false };
}

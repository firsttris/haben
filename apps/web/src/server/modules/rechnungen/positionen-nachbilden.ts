import { computeInvoice, type PriceMode } from "@haben/core";

type Totals = ReturnType<typeof computeInvoice>["totals"];

export interface RebuiltInvoice {
  priceMode: PriceMode;
  totals: Totals;
  lines: {
    position: number;
    description: string;
    quantity: number;
    unit: "Psch.";
    unitPrice: number;
    taxRate: 1900 | 700 | 0;
    net: number;
  }[];
}

/**
 * Bildet eine Rechnung, die woanders geschrieben wurde, aus Netto und Steuer je Steuersatz nach: eine Pauschalposition je
 * Satz. Die Summen müssen centgenau zur Rechnung passen (`passt` entscheidet das), sonst stimmt die Steuer nicht, auch nicht
 * bei einem späteren Storno: erst netto rechnen, sonst brutto (Endpreise). Passt keins von beiden, liefert die Funktion die
 * Steuer der Nettorechnung für die Fehlermeldung des Aufrufers.
 * Gemeinsam für die Übernahme einer Fremdrechnung (fremdrechnung.ts) und den Umzug (archiv/legacy-open.ts).
 */
export function rebuildInvoiceLines(
  taxes: { rate: number; net: number; tax: number }[],
  beschreibung: (rate: number, mehrere: boolean) => string,
  passt: (totals: Totals) => boolean,
): ({ ok: true } & RebuiltInvoice) | { ok: false; netTax: number } {
  const attempt = (priceMode: PriceMode): RebuiltInvoice => {
    const lines = taxes.map((t, i) => ({
      position: i + 1,
      description: beschreibung(t.rate, taxes.length > 1),
      quantity: 1000,
      unit: "Psch." as const,
      unitPrice: priceMode === "brutto" ? t.net + t.tax : t.net,
      taxRate: t.rate as 1900 | 700 | 0,
    }));
    const { totals, lineNets } = computeInvoice(lines, priceMode);
    return { priceMode, totals, lines: lines.map((l, i) => ({ ...l, net: lineNets[i]! })) };
  };
  const net = attempt("netto");
  if (passt(net.totals)) return { ok: true, ...net };
  const gross = attempt("brutto");
  if (passt(gross.totals)) return { ok: true, ...gross };
  return { ok: false, netTax: net.totals.tax };
}

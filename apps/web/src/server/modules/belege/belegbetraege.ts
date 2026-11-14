import { convertForeignAmounts, taxOf } from "@haben/core";
import { DocumentError } from "./documents.ts";

/** Höchstwert der int4-Spalten: umgerechnete Beträge (kleiner Kurs) dürfen ihn nicht sprengen */
const MAX_EURO_CENTS = 2_147_483_647;

/**
 * Euro-Beträge je Zeile: in Euro wie eingegeben, bei Fremdwährung mit dem Kurs umgerechnet.
 * Ohne Kurs bleiben die Euro-Beträge 0; der Beleg ist dann noch nicht buchbar.
 * Die Steuer nach § 13b und beim innergemeinschaftlichen Erwerb steht nicht auf der Rechnung, der Empfänger berechnet
 * sie aus dem Netto (§ 13b Abs. 5, § 13 Abs. 1 Nr. 6 UStG); deshalb rechnet sie der Server wie bei Fremdwährung selbst.
 */
export function euroAmounts(input: {
  currency: string;
  exchangeRate: string | null;
  reverseCharge: string | null;
  amounts: { taxRate: number; net: number; tax: number; originalNet: number | null; originalTax: number | null; vorsteuerAnteil?: number | null }[];
}) {
  if (input.currency === "EUR") {
    return input.amounts.map((a) => ({
      taxRate: a.taxRate,
      net: a.net,
      tax: input.reverseCharge ? taxOf(a.net, a.taxRate) : a.tax,
      originalNet: null,
      originalTax: null,
      vorsteuerAnteil: a.vorsteuerAnteil ?? null,
    }));
  }
  const originals = input.amounts.map((a) => ({
    taxRate: a.taxRate,
    originalNet: a.originalNet ?? 0,
    originalTax: a.originalTax ?? 0,
    vorsteuerAnteil: a.vorsteuerAnteil ?? null,
  }));
  if (!input.exchangeRate) return originals.map((o) => ({ ...o, net: 0, tax: 0 }));
  const euro = convertForeignAmounts(originals, input.exchangeRate, Boolean(input.reverseCharge));
  if (euro.some((e) => Math.abs(e.net) > MAX_EURO_CENTS || Math.abs(e.tax) > MAX_EURO_CENTS)) {
    throw new DocumentError("Der umgerechnete Betrag ist zu groß. Stimmt der Kurs (1 EUR = … Fremdwährung)?");
  }
  return originals.map((o, i) => ({ ...o, net: euro[i]!.net, tax: euro[i]!.tax }));
}

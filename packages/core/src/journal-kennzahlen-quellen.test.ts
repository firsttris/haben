import { describe, expect, it } from "vitest";
import { computeInvoiceTotals } from "./invoice.ts";
import { kennzahlenAusJournal } from "./journal-kennzahlen.ts";
import { documentPosting, invoicePosting } from "./posting.ts";
import { verprobeBuchung } from "./ust-verprobung.ts";

/*
 * Referenzfälle mit Zahlen aus einer unabhängigen Quelle (#1116): Die Erwartungen stehen so in der Quelle, sie sind nicht
 * in Haben gerechnet. Die Buchung entsteht wie in Haben (computeInvoiceTotals, documentPosting bzw. invoicePosting), die
 * Kennzahlen kommen aus dem Journal (kennzahlenAusJournal). Weitere Fälle aus dem UStAE, DATEV oder einer zweiten Software: #1203.
 */

describe.each(["SKR03", "SKR04"] as const)("Referenzfälle aus dem UStAE (%s)", (kr) => {
  // UStAE 15.4 Abs. 2 und Abs. 3, Beispiel (Stand 31.12.2025): Kleinbetragsrechnung über 149,95 € zu 19 %:
  // „149,95 € / 1,19 = 126,01 € Entgelt; 149,95 € ./. 126,01 € = 23,94 € Vorsteuer“
  it.each(["ist", "soll"] as const)("Vorsteuer aus einer Kleinbetragsrechnung, Bruttobetrag 149,95 € (%s)", (v) => {
    const beleg = computeInvoiceTotals([{ quantity: 1000, unitPrice: 149_95, taxRate: 1900 }], "brutto");
    expect(beleg.taxes).toEqual([{ rate: 1900, base: 126_01, tax: 23_94 }]);
    const zeilen = documentPosting(beleg, "software", kr, "einzelunternehmen", "bank");
    expect(kennzahlenAusJournal(kr, v, [zeilen]).kz66).toBe(23_94);
    expect(verprobeBuchung(kr, v, zeilen)).toEqual([]);
  });

  // UStAE 13.7, Beispiel (Stand 31.12.2025): Rechnung über „insgesamt 238 €“ mit „19 % … Umsatzsteuer in Höhe von 38 €“;
  // „nicht beanstandet, wenn der Unternehmer die in der Rechnung ausgewiesene Steuer in voller Höhe … anmeldet“. Haben
  // meldet die ausgewiesene Steuer bei Soll mit der Rechnung.
  it("ausgewiesene Steuer einer Rechnung über 238 € brutto zu 19 % (soll)", () => {
    const rechnung = computeInvoiceTotals([{ quantity: 1000, unitPrice: 238_00, taxRate: 1900 }], "brutto");
    const k = kennzahlenAusJournal(kr, "soll", [invoicePosting(rechnung, kr, "soll")]);
    expect({ kz81: k.kz81, tax81: k.tax81 }).toEqual({ kz81: 200_00, tax81: 38_00 });
  });
});

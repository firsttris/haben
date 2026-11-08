import { describe, expect, it } from "vitest";
import { computeEuer } from "./euer.ts";
import { ebilanzPosition } from "./ebilanz.ts";
import { postenForSaldo } from "./hgb.ts";
import { computeInvoiceTotals } from "./invoice.ts";
import { documentPosting, EXPENSE_CATEGORIES, type ExpenseCategory } from "./posting.ts";

/*
 * Weitere Ausgabekategorien (Roadmap Platz 1, #312): Miete, sonstiger Betriebsbedarf, Reparatur sonstiger Anlagen,
 * sonstige Fahrzeugkosten, Berufsgenossenschaft, Versorgungskassen. Konten nach dem DATEV-Kontenrahmen 2026
 * (SKR03 Art.-Nr. 11174, SKR04 Art.-Nr. 11175), GuV nach § 275 Abs. 2 HGB, E-Bilanz nach der Taxonomie 6.10.
 */

const OC = "is.netIncome.regular.operatingTC.otherCost";
const SOCIAL = "is.netIncome.regular.operatingTC.staff.social";

const NEU: [ExpenseCategory, string, string, "sonstigeAufwendungen" | "personalaufwand", string][] = [
  ["miete", "4210", "6310", "sonstigeAufwendungen", `${OC}.leaseFix.other`],
  ["betriebsbedarf", "4980", "6850", "sonstigeAufwendungen", `${OC}.miscellaneous`],
  ["reparatur", "4805", "6470", "sonstigeAufwendungen", `${OC}.fixing`],
  ["kfzSonstige", "4580", "6570", "sonstigeAufwendungen", `${OC}.vehicles`],
  ["berufsgenossenschaft", "4138", "6120", "personalaufwand", `${SOCIAL}.socExp.other`],
  ["versorgungskassen", "4160", "6150", "personalaufwand", `${SOCIAL}.pensions.other`],
];

describe.each(NEU)("Kategorie %s", (kategorie, skr03, skr04, posten, ebilanz) => {
  it("Konto nach DATEV-Kontenrahmen SKR03 und SKR04", () => {
    expect(EXPENSE_CATEGORIES[kategorie]).toMatchObject({ SKR03: skr03, SKR04: skr04 });
  });

  it("Beleg: Aufwand und Vorsteuer an Verbindlichkeiten, in beiden Kontenrahmen", () => {
    const totals = computeInvoiceTotals([{ quantity: 1000, unitPrice: 100_00, taxRate: 1900 }]);
    expect(documentPosting(totals, kategorie, "SKR03", "einzelunternehmen", "bank").map((l) => [l.account, l.debit, l.credit])).toEqual([
      [skr03, 100_00, 0],
      ["1576", 19_00, 0],
      ["1600", 0, 119_00],
    ]);
    expect(documentPosting(totals, kategorie, "SKR04", "gmbh", "bank").map((l) => l.account)).toEqual([skr04, "1406", "3300"]);
  });

  it("HGB-GuV und E-Bilanz-Position", () => {
    for (const konto of [skr03, skr04]) {
      const kr = konto === skr03 ? "SKR03" : "SKR04";
      expect(postenForSaldo(kr, konto, 100_00)).toBe(posten);
      expect(ebilanzPosition(kr, konto, 100_00)).toBe(ebilanz);
    }
  });

  it("EÜR: eigene Zeile mit der Bezeichnung der Kategorie", () => {
    const totals = computeInvoiceTotals([{ quantity: 1000, unitPrice: 100_00, taxRate: 1900 }]);
    const euer = computeEuer(2026, [{ kind: "document", date: "2026-03-01", paid: 119_00, totals, category: kategorie }]);
    expect(euer.ausgaben.find((l) => l.key === `ausgabe:${kategorie}`)).toMatchObject({ amount: 100_00, label: EXPENSE_CATEGORIES[kategorie].label });
    expect(euer.ausgaben.find((l) => l.key === "vorsteuer")?.amount).toBe(19_00);
  });
});

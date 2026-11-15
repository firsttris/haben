import { describe, expect, it } from "vitest";
import { invoiceLineInputSchema } from "./invoice.ts";
import { UNIT_LABEL_MAX, unitLabelIssues } from "./units.ts";

/*
 * Eigene Mengeneinheiten (#748): Bezeichnung, wie sie auf dem Beleg steht, und Code nach UN/ECE Recommendation 20/21 für die
 * E-Rechnung (BT-130). Die festen Einheiten bleiben; eine eigene darf keiner von ihnen gleichen.
 */
describe("Eigene Einheiten", () => {
  it("nimmt kurze Bezeichnungen wie UE, m² oder lfm", () => {
    for (const label of ["UE", "m²", "lfm", "Karton"]) expect(unitLabelIssues(label, [])).toEqual([]);
  });

  it("lehnt Leeres, zu Langes, feste und schon angelegte Einheiten sowie Zeichen ohne Belegschrift ab", () => {
    expect(unitLabelIssues("  ", [])).toEqual([expect.stringContaining("Bezeichnung fehlt")]);
    expect(unitLabelIssues("x".repeat(UNIT_LABEL_MAX + 1), [])).toEqual([expect.stringContaining(`${UNIT_LABEL_MAX} Zeichen`)]);
    expect(unitLabelIssues("std.", [])).toEqual([expect.stringContaining("gibt es schon")]);
    expect(unitLabelIssues("UE", ["ue"])).toEqual([expect.stringContaining("gibt es schon")]);
    expect(unitLabelIssues("☎", [])).toEqual([expect.stringContaining("☎")]);
  });

  it("eine Position nimmt jede Bezeichnung bis zur Höchstlänge; ob es sie gibt, prüft der Server", () => {
    const line = { description: "Nachhilfe", quantity: 2000, unitPrice: 2500, taxRate: 0 as const };
    expect(invoiceLineInputSchema.safeParse({ ...line, unit: "UE" }).success).toBe(true);
    expect(invoiceLineInputSchema.safeParse({ ...line, unit: " " }).success).toBe(false);
    expect(invoiceLineInputSchema.safeParse({ ...line, unit: "x".repeat(UNIT_LABEL_MAX + 1) }).success).toBe(false);
  });
});

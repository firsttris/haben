import { describe, expect, it } from "vitest";
import { KIRCHENSTEUER_HINWEIS, kirchensteuerFortschreibung } from "./kirchensteuer.ts";

describe("Hinweis zur gezahlten Kirchensteuer (#1451)", () => {
  it("nennt am Feld Vorauszahlungen, Nachzahlungen und die einbehaltene Lohnkirchensteuer", () => {
    for (const teil of ["Vorauszahlungen", "Nachzahlungen", "Lohnkirchensteuer", "Lohnsteuerbescheinigung"]) {
      expect(KIRCHENSTEUER_HINWEIS, teil).toContain(teil);
    }
    // Der alte Hinweis nannte nur die Ausnahme; die bleibt richtig und muss bleiben
    expect(KIRCHENSTEUER_HINWEIS).toContain("nicht die Kirchensteuer auf Kapitalerträge");
  });

  it("nennt in der fortgeschriebenen Prognose beide Jahre und die Lohnkirchensteuer", () => {
    const text = kirchensteuerFortschreibung(2025, 2026);
    expect(text).toContain("aus 2025");
    expect(text).toContain("für 2026");
    expect(text).toContain("Lohnkirchensteuer laut Lohnsteuerbescheinigung");
    expect(text).toContain("§ 10 Abs. 4b Satz 3 EStG");
  });
});

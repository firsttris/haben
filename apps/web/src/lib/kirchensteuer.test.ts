import { describe, expect, it } from "vitest";
import { KIRCHENSTEUER_FORTSCHREIBUNG, KIRCHENSTEUER_HINWEIS } from "./kirchensteuer.ts";

describe("Hinweis zur gezahlten Kirchensteuer (#1451)", () => {
  it("nennt am Feld Vorauszahlungen, Nachzahlungen und die einbehaltene Lohnkirchensteuer", () => {
    for (const teil of ["Vorauszahlungen", "Nachzahlungen", "Lohnkirchensteuer"]) {
      expect(KIRCHENSTEUER_HINWEIS, teil).toContain(teil);
    }
    // Die Bescheinigung weist sie an zwei Stellen aus: Nr. 6 und 7 zum laufenden Arbeitslohn, Nr. 13 und 14 zu den
    // ermäßigt besteuerten sonstigen Bezügen (Muster der Lohnsteuerbescheinigung 2024).
    expect(KIRCHENSTEUER_HINWEIS).toContain("Nr. 6 und 7, bei sonstigen Bezügen Nr. 13 und 14");
    // Der alte Hinweis nannte nur die Ausnahme; die bleibt richtig und muss bleiben
    expect(KIRCHENSTEUER_HINWEIS).toContain("nicht die Kirchensteuer auf Kapitalerträge");
  });

  it("nennt in der Prognose dieselben Stellen und verspricht keinen Überhang, den es nicht geben muss", () => {
    expect(KIRCHENSTEUER_FORTSCHREIBUNG).toContain("Nr. 6 und 7, bei sonstigen Bezügen Nr. 13 und 14");
    // Ohne die Lohnkirchensteuer kann ein Überhang entstehen, muss aber nicht: bleibt die Erstattung unter der
    // gezahlten Kirchensteuer, ist der Überhang null, oder er ist nur zu hoch.
    expect(KIRCHENSTEUER_FORTSCHREIBUNG).toContain("kann die Prognose einen Erstattungsüberhang ausweisen oder zu hoch ansetzen");
    expect(KIRCHENSTEUER_FORTSCHREIBUNG).toContain("§ 10 Abs. 4b Satz 3 EStG");
  });
});

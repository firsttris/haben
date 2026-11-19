import { describe, expect, it } from "vitest";
import { KIRCHENSTEUER_FORTSCHREIBUNG, KIRCHENSTEUER_HINWEIS } from "./kirchensteuer.ts";

describe("Hinweis zur gezahlten Kirchensteuer (#1451)", () => {
  it("nennt am Feld Vorauszahlungen, Nachzahlungen und die einbehaltene Lohnkirchensteuer", () => {
    for (const teil of ["Vorauszahlungen", "Nachzahlungen", "Kirchgeld", "Lohnkirchensteuer"]) {
      expect(KIRCHENSTEUER_HINWEIS, teil).toContain(teil);
    }
    // Nr. 6 und 7 stehen in jeder Bescheinigung. Nr. 13 und 14 (ermäßigt besteuerte sonstige Bezüge) nur bis 2024:
    // Seit 2025 gibt es die Fünftelregelung im Lohnsteuerabzug nicht mehr, im BMF-Muster für 2026 sind die Felder
    // unbesetzt (Schreiben vom 29.8.2025).
    expect(KIRCHENSTEUER_HINWEIS).toContain("Nr. 6 und 7, bis 2024 bei sonstigen Bezügen auch Nr. 13 und 14");
    // Der alte Hinweis nannte nur die Ausnahme; die bleibt richtig und muss bleiben
    // Nur der Zuschlag zur Abgeltungsteuer ist ausgeschlossen; Kirchensteuer auf tariflich besteuerte
    // Kapitalerträge zählt mit (§ 10 Abs. 1 Nr. 4 Halbsatz 2 EStG).
    expect(KIRCHENSTEUER_HINWEIS).toContain("nicht die Kirchensteuer zur Abgeltungsteuer");
    expect(KIRCHENSTEUER_HINWEIS).not.toContain("auf Kapitalerträge");
  });

  it("nennt in der Prognose dieselben Stellen und verspricht keinen Überhang, den es nicht geben muss", () => {
    expect(KIRCHENSTEUER_FORTSCHREIBUNG).toContain("Nr. 6 und 7, bis 2024 bei sonstigen Bezügen auch Nr. 13 und 14");
    // Ohne die Lohnkirchensteuer kann ein Überhang entstehen, muss aber nicht: bleibt die Erstattung unter der
    // gezahlten Kirchensteuer, ist der Überhang null, oder er ist nur zu hoch.
    expect(KIRCHENSTEUER_FORTSCHREIBUNG).toContain("kann die Prognose einen Erstattungsüberhang ausweisen oder zu hoch ansetzen");
    expect(KIRCHENSTEUER_FORTSCHREIBUNG).toContain("§ 10 Abs. 4b Satz 3 EStG");
  });
});

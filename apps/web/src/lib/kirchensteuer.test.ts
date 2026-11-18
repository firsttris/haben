import { describe, expect, it } from "vitest";
import { KIRCHENSTEUER_FORTSCHREIBUNG, KIRCHENSTEUER_HINWEIS } from "./kirchensteuer.ts";

describe("Hinweis zur gezahlten Kirchensteuer (#1451)", () => {
  it("nennt am Feld Vorauszahlungen, Nachzahlungen und die einbehaltene Lohnkirchensteuer", () => {
    for (const teil of ["Vorauszahlungen", "Nachzahlungen", "Lohnkirchensteuer", "Lohnsteuerbescheinigung"]) {
      expect(KIRCHENSTEUER_HINWEIS, teil).toContain(teil);
    }
    // Das Feld ist ein Betrag für die Veranlagung; bei Konfessionsverschiedenen steht die Kirchensteuer des Ehegatten
    // in Nr. 7 derselben Bescheinigung.
    expect(KIRCHENSTEUER_HINWEIS).toContain("Nr. 6, für den Ehegatten Nr. 7");
    // Der alte Hinweis nannte nur die Ausnahme; die bleibt richtig und muss bleiben
    expect(KIRCHENSTEUER_HINWEIS).toContain("nicht die Kirchensteuer auf Kapitalerträge");
  });

  it("nennt in der Prognose dieselben Felder der Bescheinigung", () => {
    expect(KIRCHENSTEUER_FORTSCHREIBUNG).toContain("Lohnkirchensteuer laut Lohnsteuerbescheinigung (Nr. 6, für den Ehegatten Nr. 7)");
    expect(KIRCHENSTEUER_FORTSCHREIBUNG).toContain("§ 10 Abs. 4b Satz 3 EStG");
  });
});

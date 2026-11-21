import { describe, expect, it } from "vitest";
import { vorauszahlungHinweis } from "./-finanzamt-daten.ts";

/*
 * #1287: Der Reiter „Vorauszahlungen herabsetzen“ liest den Haken „Keine Einkommensteuer-Vorauszahlungen
 * festgesetzt“ und erklärt den Antrag als gegenstandslos. Versteckt wird nichts: Der Haken ist eine Angabe
 * der Person, kein Bescheid, deshalb bleibt das Formular in beiden Fällen erreichbar.
 */
describe("Hinweis im Reiter Vorauszahlungen herabsetzen", () => {
  it("erklärt den Antrag bei gesetztem Haken als gegenstandslos und nennt den Ort der Angabe", () => {
    const text = vorauszahlungHinweis(true);
    expect(text).toContain("keine Vorauszahlungen festgesetzt");
    expect(text).toContain("gegenstandslos");
    expect(text).toContain("Einstellungen › Persönliche Angaben");
  });

  it("zeigt ohne Haken keinen Hinweis", () => {
    expect(vorauszahlungHinweis(false)).toBeNull();
  });
});

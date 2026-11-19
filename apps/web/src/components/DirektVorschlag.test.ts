import { describe, expect, it } from "vitest";
import { vorschlagTitel } from "./DirektVorschlag.ts";

/*
 * #1369: Die Karte eines gelernten Aufladungs-Vorschlags nannte „Ausgabe: Telefon“, weil die Aufladung ihre Kategorie
 * mitbringt. Sie nennt jetzt ihre Art; die Kategorie steht im Dialog darunter.
 */
describe("Titel der Vorschlagskarte im Zuordnungsdialog", () => {
  it("nennt eine Aufladung ihre Art, nicht die Kategorie", () => {
    expect(vorschlagTitel({ kind: "aufladung", kategorie: { kategorie: "telefon", steuersatz: 0 } }, "SKR03")).toBe("Aufladung Guthaben");
    // Auch wenn ein alter Vorschlag aus der Zeit vor der Sperre eine Einnahme trägt
    expect(vorschlagTitel({ kind: "aufladung", kategorie: { kategorie: "erloese", steuersatz: 1900 } }, "SKR03")).toBe("Aufladung Guthaben");
  });

  it("nennt bei einer Kategorie weiter die Kategorie mit ihrer Richtung", () => {
    expect(vorschlagTitel({ kind: "kategorie", kategorie: { kategorie: "telefon", steuersatz: 0 } }, "SKR03")).toBe("Ausgabe: 4920 · Telefon");
    expect(vorschlagTitel({ kind: "kategorie", kategorie: { kategorie: "erloese", steuersatz: 1900 } }, "SKR03")).toBe("Einnahme: Erlöse 19 %");
  });

  it("nennt bei Ausgaben die Nummer des Kontos im Kontenrahmen der Firma (#1438)", () => {
    expect(vorschlagTitel({ kind: "kategorie", kategorie: { kategorie: "telefon", steuersatz: 0 } }, "SKR04")).toBe("Ausgabe: 6805 · Telefon");
  });

  it("lässt jede andere Art ihren Namen aus der Liste tragen", () => {
    expect(vorschlagTitel({ kind: "privat", kategorie: null }, "SKR03")).toBeNull();
    expect(vorschlagTitel({ kind: "geldtransit" }, "SKR03")).toBeNull();
  });
});

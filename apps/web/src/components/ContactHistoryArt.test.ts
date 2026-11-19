import { describe, expect, it } from "vitest";
import { belegArt } from "./ContactHistoryArt.ts";

describe("Spalte „Art“ der Kontakthistorie bei einem Beleg (#1438)", () => {
  it("nennt die Nummer des Kontos im Kontenrahmen der Firma", () => {
    expect(belegArt({ category: "telefon", splitCount: 0 }, "SKR03")).toBe("4920 · Telefon");
    expect(belegArt({ category: "telefon", splitCount: 0 }, "SKR04")).toBe("6805 · Telefon");
  });

  it("lässt das Anlagegut und unbekannte Werte aus einem Import ohne Nummer", () => {
    expect(belegArt({ category: "anlage", splitCount: 0 }, "SKR03")).toBe("Anlagegut (wird abgeschrieben)");
    expect(belegArt({ category: "Büromaterial (Import)", splitCount: 0 }, "SKR04")).toBe("Büromaterial (Import)");
  });

  it("nennt einen aufgeteilten Beleg und einen ohne Kategorie wie bisher", () => {
    expect(belegArt({ category: null, splitCount: 3 }, "SKR03")).toBe("Aufgeteilt auf 3 Zeilen");
    expect(belegArt({ category: null, splitCount: 0 }, "SKR03")).toBe("–");
  });
});

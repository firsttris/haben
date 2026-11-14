import { describe, expect, it } from "vitest";
import { emptyLine, positionsFehler } from "./editor-lines.ts";

const zeile = (patch: Partial<ReturnType<typeof emptyLine>>) => ({ ...emptyLine("Std.", 1900), ...patch });

describe("positionsFehler", () => {
  it("ist null für eine vollständige Position", () => {
    expect(positionsFehler(zeile({ description: "Beratung", quantity: "2", unitPrice: "95,00" }))).toBeNull();
  });

  it("nennt alles, was fehlt, in einem Satz", () => {
    expect(positionsFehler(zeile({ quantity: "0" }))).toBe("Trag die Beschreibung, eine Menge über 0 und den Einzelpreis ein.");
    expect(positionsFehler(zeile({ description: "Beratung", unitPrice: "" }))).toBe("Trag den Einzelpreis ein.");
  });

  it("prüft ohne Rabatt nur Beschreibung, Menge und Einzelpreis (Serienrechnung)", () => {
    expect(positionsFehler({ description: "Wartung {monat}", quantity: "1", unitPrice: "abc" })).toBe("Trag den Einzelpreis ein.");
    expect(positionsFehler({ description: "Wartung {monat}", quantity: "1", unitPrice: "120,00" })).toBeNull();
  });

  it("erklärt einen Rabatt, der nicht passt", () => {
    expect(positionsFehler(zeile({ description: "Beratung", unitPrice: "95,00", discount: "abc" }))).toBe(
      "Rabatt als Prozent (z. B. 5 %) oder Betrag (z. B. 100,00).",
    );
    expect(positionsFehler(zeile({ description: "Beratung", unitPrice: "95,00", discount: "100,00" }))).toBe("Der Rabatt ist höher als die Position.");
  });
});

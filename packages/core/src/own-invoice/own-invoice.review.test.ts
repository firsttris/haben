import { describe, expect, it } from "vitest";
import { detectOwnInvoice, type OwnCompany, type TextLine } from "./index.ts";

// TDD-Review PR #362: Verdachte zur Zuordnung über die Zeile darüber

const company: OwnCompany = {
  name: "Musterdesign GmbH",
  ustId: "DE123456789",
  steuernummern: ["21/815/08150", "2181508150"],
  iban: "DE89 3704 0044 0532 0130 00",
  plz: "70173",
};

const line = (text: string, top: number, left = 0.1): TextLine => ({ page: 1, text, top, left });

describe("Review: Informationsblock einer eigenen Rechnung", () => {
  it("Kundennummer in der Zeile über der eigenen USt-IdNr. macht die eigene Rechnung nicht zur fremden", () => {
    // Übliches Layout: Informationsblock rechts neben dem Anschriftfeld (DIN 5008), je Angabe eine Zeile
    const lines: TextLine[] = [
      line("Musterdesign GmbH · Königstraße 1 · 70173 Stuttgart", 0.16),
      line("Kunde AG", 0.19),
      line("Rechnungsnummer: RE-2026-042", 0.19, 0.6),
      line("Hauptstraße 5", 0.21),
      line("Kundennummer: 10042", 0.21, 0.6),
      line("USt-IdNr.: DE 123 456 789", 0.23, 0.6),
      line("10115 Berlin", 0.23),
      line("Gesamtbetrag 1.190,00 €", 0.6),
      line("Musterdesign GmbH · Geschäftsführer Max Muster · Amtsgericht Stuttgart HRB 12345", 0.9),
      line("St.-Nr. 21/815/08150", 0.92),
      line("Bankverbindung: IBAN DE89 3704 0044 0532 0130 00", 0.94),
    ];
    const verdict = detectOwnInvoice({ lines }, company);
    expect(verdict.level).toBe("sicher");
    expect(verdict.signals.filter((s) => s.direction === "foreign")).toEqual([]);
  });
});

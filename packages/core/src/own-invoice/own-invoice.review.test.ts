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

// Zweites TDD-Review PR #363: Fehlalarme bei echten Eingangsrechnungen an uns

/** Einzelunternehmen: Firmenname mit Zusatz, angeschrieben wird die Inhaberin mit ihrem Namen */
const einzelunternehmen: OwnCompany = {
  name: "Musterdesign Weber",
  ustId: "DE123456789",
  steuernummern: ["21/815/08150", "2181508150"],
  iban: "DE89 3704 0044 0532 0130 00",
  plz: "70173",
};

describe("Review: Eingangsrechnungen, die eigene Angaben nennen", () => {
  it("Beitragsrechnung mit Lastschrift: die eigene IBAN unter dem Einzugstext ist kein Zahlungsziel", () => {
    // Versicherungen sind umsatzsteuerfrei (§ 4 Nr. 10 UStG) und drucken keine USt-IdNr.; der Einzugstext steht zwei
    // Zeilen über der IBAN, dazwischen der Kontoinhaber
    const lines: TextLine[] = [
      line("Hanse Versicherung AG · Postfach 1234 · 20095 Hamburg", 0.16),
      line("Frau Anna Weber", 0.19),
      line("Königstraße 1", 0.21),
      line("70173 Stuttgart", 0.23),
      line("Beitragsrechnung 2027", 0.35),
      line("Jahresbeitrag Betriebshaftpflicht 476,00 €", 0.45),
      line("Den Beitrag ziehen wir am 01.01.2027 per SEPA-Lastschrift ein von:", 0.5),
      line("Kontoinhaber: Anna Weber", 0.52),
      line("IBAN: DE89 3704 0044 0532 0130 00", 0.54),
      line("Hanse Versicherung AG · Sitz Hamburg · Amtsgericht Hamburg HRB 999", 0.92),
    ];
    expect(detectOwnInvoice({ lines }, einzelunternehmen).level).toBe("keine");
  });

  it("Rechnung der Steuerberatung mit der eigenen Steuernummer im Betreff ist keine eigene Rechnung", () => {
    // Die Kanzlei nennt in der Fußzeile ihre eigene Steuernummer (Pflichtangabe nach § 14 Abs. 4 Nr. 2 UStG, statt der
    // USt-IdNr.); im Betreff steht die Steuernummer der Mandantin
    const lines: TextLine[] = [
      line("Steuerkanzlei Berg · Marktplatz 2 · 70173 Stuttgart", 0.16),
      line("Frau Anna Weber", 0.19),
      line("Königstraße 1", 0.21),
      line("70173 Stuttgart", 0.23),
      line("Rechnung Nr. 2026-311", 0.35),
      line("Einkommensteuererklärung 2025, St.-Nr. 21/815/08150", 0.4),
      line("Gebühr nach § 24 StBVV 840,00 €", 0.45),
      line("Steuerkanzlei Berg · Steuernummer 99/123/45678 · Bankverbindung IBAN DE02 6005 0101 0002 0343 04", 0.92),
    ];
    expect(detectOwnInvoice({ lines }, einzelunternehmen).level).toBe("keine");
  });
});

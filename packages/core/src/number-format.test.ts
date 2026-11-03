import { describe, expect, it } from "vitest";
import { purposeContainsNumber } from "./matching.ts";
import {
  DEFAULT_CUSTOMER_NUMBER_FORMAT,
  DEFAULT_INVOICE_NUMBER_FORMAT,
  DEFAULT_QUOTE_NUMBER_FORMAT,
  formatDocumentNumber,
  numberFormatError,
} from "./number-format.ts";

describe("formatDocumentNumber", () => {
  it("bleibt ab Werk bei 2026-034 und AN-2026-007", () => {
    expect(formatDocumentNumber(DEFAULT_INVOICE_NUMBER_FORMAT, 2026, 34)).toBe("2026-034");
    expect(formatDocumentNumber(DEFAULT_QUOTE_NUMBER_FORMAT, 2026, 7)).toBe("AN-2026-007");
  });

  it("setzt Präfix, zweistelliges Jahr und Stellenzahl ein", () => {
    expect(formatDocumentNumber("RE-{JJJJ}-{NNNN}", 2026, 34)).toBe("RE-2026-0034");
    expect(formatDocumentNumber("R{JJ}{NNN}", 2026, 5)).toBe("R26005");
    expect(formatDocumentNumber("{JJ}.{N}", 2009, 12)).toBe("09.12");
  });

  it("schneidet nie ab, wenn die laufende Nummer mehr Stellen hat", () => {
    expect(formatDocumentNumber("{JJJJ}-{NN}", 2026, 1234)).toBe("2026-1234");
  });
});

describe("Bankabgleich mit eigenem Format", () => {
  it("findet die Nummer im Verwendungszweck, auch klein und ohne Trennzeichen", () => {
    const number = formatDocumentNumber("RE-{JJJJ}-{NNNN}", 2026, 34);
    expect(purposeContainsNumber("Zahlung re 2026 0034 danke", number)).toBe(true);
    expect(purposeContainsNumber("RE2026003", number)).toBe(false);
    expect(purposeContainsNumber("Rechnung R26034", formatDocumentNumber("R{JJ}{NNN}", 2026, 34))).toBe(true);
  });
});

describe("numberFormatError", () => {
  it("lässt die Vorgaben und übliche Muster durch", () => {
    for (const format of [DEFAULT_INVOICE_NUMBER_FORMAT, DEFAULT_QUOTE_NUMBER_FORMAT, "RE-{JJJJ}-{NNNN}", "R{JJ}{NNN}", "{JJJJ}_{N}.A"]) {
      expect(numberFormatError(format), format).toBeNull();
    }
  });

  it("verlangt genau eine laufende Nummer", () => {
    expect(numberFormatError("RE-{JJJJ}")).toMatch(/laufende Nummer/);
    expect(numberFormatError("{JJJJ}-{NNN}-{NN}")).toMatch(/genau einmal/);
  });

  it("verlangt das Jahr, weil der Zähler jedes Jahr neu beginnt", () => {
    expect(numberFormatError("RE-{NNN}")).toMatch(/Jahr/);
  });

  it("lehnt unbekannte Platzhalter, Zeichen für Dateinamen und Überlänge ab", () => {
    expect(numberFormatError("{JJJJ}-{MM}-{NNN}")).toMatch(/\{MM\}/);
    expect(numberFormatError("{JJJJ}-{NNNNNNN}")).toMatch(/\{NNNNNNN\}/);
    expect(numberFormatError("RE/{JJJJ}/{NNN}")).toMatch(/Buchstaben, Ziffern/);
    expect(numberFormatError("RE {JJJJ}-{NNN}")).toMatch(/Buchstaben, Ziffern/);
    expect(numberFormatError("{JJJJ-{NNN}")).toMatch(/Buchstaben, Ziffern/);
    expect(numberFormatError(`${"X".repeat(30)}{JJJJ}{NNN}`)).toMatch(/30 Zeichen/);
  });

  it("verlangt bei Kundennummern kein Jahr, weil deren Zähler nicht jährlich neu beginnt", () => {
    expect(numberFormatError("K-{NNNN}", { requireYear: false })).toBeNull();
    expect(numberFormatError(DEFAULT_CUSTOMER_NUMBER_FORMAT, { requireYear: false })).toBeNull();
    expect(formatDocumentNumber(DEFAULT_CUSTOMER_NUMBER_FORMAT, 2026, 7)).toBe("K-0007");
    expect(numberFormatError("K-", { requireYear: false })).toMatch(/laufende Nummer/);
    expect(numberFormatError("K {NNNN}", { requireYear: false })).toMatch(/Buchstaben, Ziffern/);
  });
});

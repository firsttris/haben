import { describe, expect, it } from "vitest";
import { MAX_TELEFON_LENGTH, normalizeTelefon, telefonProblem } from "./telefon.ts";

describe("Telefonnummer am Kontakt", () => {
  it("nimmt übliche Schreibweisen mit Vorwahl, Durchwahl und Ländervorwahl", () => {
    for (const nummer of ["0941 123456", "+49 941 123456-0", "+49 (0)941 12 34 56", "0941/123456", "0170.1234567", ""]) {
      expect(telefonProblem(nummer)).toBeNull();
    }
  });

  it("lehnt Buchstaben, E-Mail-Adressen und zu lange Nummern ab", () => {
    expect(telefonProblem("Zentrale 0941 1234")).toBe("Telefon: nur Ziffern, Leerzeichen und + ( ) / - .");
    expect(telefonProblem("info@example.com")).toBe("Telefon: nur Ziffern, Leerzeichen und + ( ) / - .");
    expect(telefonProblem("1".repeat(MAX_TELEFON_LENGTH + 1))).toBe(`Telefon: höchstens ${MAX_TELEFON_LENGTH} Zeichen`);
    expect(telefonProblem("+ - /")).toBe("Telefon: ohne Ziffern");
  });

  it("schreibt die Nummer, wie sie eingegeben wurde, ohne Leerzeichen am Rand und doppelte Leerzeichen", () => {
    expect(normalizeTelefon("  +49  941   123456 ")).toBe("+49 941 123456");
  });
});

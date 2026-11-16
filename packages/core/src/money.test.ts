import { describe, expect, it } from "vitest";
import { amountError, formatDeduction, formatEuro, formatHundredths, parseEuro, taxOf } from "./money.ts";

describe("Hundertstel ohne Einheit", () => {
  it("schreibt Prozent wie Euro mit zwei Nachkommastellen", () => {
    expect(formatHundredths(1950)).toBe("19,50");
    expect(formatHundredths(-0)).toBe("0,00");
  });
});

describe("parseEuro", () => {
  it.each([
    ["1.234,56", 123456],
    ["1234,5", 123450],
    ["0", 0],
    ["12 €", 1200],
    ["-3.000,00", -300000],
    ["−45,90", -4590],
    // Währung vorn oder hinten, auch „EUR“ und mit dem geschützten Leerzeichen aus formatEuro (#1242)
    [" 12,50 € ", 1250],
    ["€ 12,50", 1250],
    ["€12,50", 1250],
    ["12,50 EUR", 1250],
    ["EUR 12,50", 1250],
    [formatEuro(123456), 123456],
    // Ein Punkt mit einer oder zwei Ziffern dahinter ist Dezimaltrenner, mit drei Ziffern Tausenderpunkt
    ["12.50", 1250],
    ["12.5", 1250],
    ["12.34", 1234],
    ["1.500", 150000],
    ["1.234.567", 123456700],
    // Leerzeichen als Tausendertrenner ist eindeutig, wenn danach je drei Ziffern folgen
    ["1 234,56", 123456],
    ["1 234 567 €", 123456700],
    // Vorzeichen vorn, auch vor der Währung
    ["+12,50", 1250],
    ["- 12,50 €", -1250],
    ["-€ 12,50", -1250],
    ["€ -12,50", -1250],
    ["–12,50", -1250],
  ])("%j → %i", (input, cents) => {
    expect(parseEuro(input)).toBe(cents);
  });

  it("lehnt lange Eingaben ohne Betrag in kurzer Zeit ab: Die Schnellsuche liest jede Suche damit", () => {
    const start = performance.now();
    for (const input of [`-${" ".repeat(150)}x`, `€${" ".repeat(150)}-x`, `${"1 ".repeat(150)}x`, `12${" ".repeat(150)}x`]) {
      expect(parseEuro(input)).toBeNull();
    }
    expect(performance.now() - start).toBeLessThan(100);
  });

  it("liest „-0,00“ als 0, nicht als −0", () => {
    expect(Object.is(parseEuro("-0,00"), 0)).toBe(true);
  });

  it.each(["", "abc", "1,234", "1.23,00", "€", "12 %", ",50", "12.", "12,", "12,505", "1.234.56", "1,234.56", "99999999999999999999"])(
    "lehnt %j ab",
    (input) => {
      expect(parseEuro(input)).toBeNull();
    },
  );

  it.each(["12€50", "1€2", "12EUR50", "1 2,50", "12 34", "1.234 567", "€ 12,50 €", "--12", "-€-12", "12,50-"])(
    "lehnt %j ab: Währung nur am Rand, Leerzeichen sonst nur zwischen Dreiergruppen, Vorzeichen nur vorn (#1242)",
    (input) => {
      expect(parseEuro(input)).toBeNull();
    },
  );
});

describe("amountError", () => {
  it("meldet einen ungültigen Betrag in einer Form, mit Beispiel aus Cent", () => {
    expect(amountError()).toBe("Trag den Betrag ein, etwa 1.234,56.");
    expect(amountError("den Preis", 12050)).toBe("Trag den Preis ein, etwa 120,50.");
    expect(amountError("einen Betrag über 0", 4990)).toBe("Trag einen Betrag über 0 ein, etwa 49,90.");
    expect(amountError("den Betrag", -12050)).toBe("Trag den Betrag ein, etwa -120,50.");
  });

  it("nennt bei einem Feld, das leer bleiben darf, auch das", () => {
    expect(amountError("die Mahngebühr", 500, { optional: true })).toBe("Trag die Mahngebühr ein, etwa 5,00, oder lass das Feld leer.");
  });
});

describe("formatEuro", () => {
  it("formatiert deutsch", () => {
    expect(formatEuro(2341872).replace(/\s/g, " ")).toBe("23.418,72 €");
  });
});

describe("formatDeduction", () => {
  // Abzugszeilen der Jahresübersicht: Vorsteuer, Einfuhrumsatzsteuer und Vorauszahlungssoll.
  // Der Abzug erscheint negativ, eine Gutschrift in derselben Zeile positiv - sonst rechnet
  // der Leser die Spalte falsch zusammen (#869).
  it("zeigt einen positiven Abzug mit Minus", () => {
    expect(formatDeduction(80000).replace(/\s/g, " ")).toBe("-800,00 €");
  });

  it("zeigt eine negative Vorsteuer ohne Minus", () => {
    expect(formatDeduction(-24552).replace(/\s/g, " ")).toBe("245,52 €");
  });

  it("trägt das Vorzeichen der Abschlusszeile unverändert", () => {
    expect(formatEuro(-5448).replace(/\s/g, " ")).toBe("-54,48 €");
    expect(formatEuro(20000).replace(/\s/g, " ")).toBe("200,00 €");
  });
});

describe("taxOf", () => {
  it("rundet kaufmännisch", () => {
    expect(taxOf(290000, 1900)).toBe(55100);
    expect(taxOf(1, 1900)).toBe(0);
    expect(taxOf(3, 1900)).toBe(1);
    expect(taxOf(-3, 1900)).toBe(-1);
  });
});

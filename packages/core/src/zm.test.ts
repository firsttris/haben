import { describe, expect, it } from "vitest";
import { aggregateZm, gemeldeterStand, isValidGermanUstId, normalizeUstId, ustIdProblem, zmBerichtigung, zmEuro, zmFrist, type ZmZeile } from "./zm.ts";

describe("normalizeUstId", () => {
  it("Großbuchstaben ohne Leerzeichen, Punkte und Bindestriche", () => {
    expect(normalizeUstId(" fr 12.345-678 901 ")).toBe("FR12345678901");
  });
  it("Griechenland als EL, wie ERiC es verlangt", () => {
    expect(normalizeUstId("GR123456789")).toBe("EL123456789");
  });
});

describe("ustIdProblem (Prüfregeln des ERiC-Plugins checkZMDO)", () => {
  it("nimmt Nummern anderer Mitgliedstaaten an", () => {
    for (const id of ["ATU12345678", "FR12345678901", "NL123456789B01", "IE1+23456B", "EL123456789", "SE123456789001"])
      expect(ustIdProblem(id, "S")).toBeNull();
  });
  it("lehnt fehlende, deutsche, britische und unbekannte Länderkennzeichen ab", () => {
    expect(ustIdProblem("", "S")).toMatch(/fehlt/);
    expect(ustIdProblem("DE123456788", "S")).toMatch(/deutsche/);
    expect(ustIdProblem("GB123456789", "L")).toMatch(/Brexit/);
    expect(ustIdProblem("CH123456789", "S")).toMatch(/Länderkennzeichen/);
  });
  it("mindestens 7 Zeichen, nur Buchstaben, Ziffern, + und *", () => {
    expect(ustIdProblem("RO1234", "S")).toMatch(/5 bis 12/);
    expect(ustIdProblem("RO12345", "S")).toBeNull();
    expect(ustIdProblem("FR1234567890#", "S")).toMatch(/5 bis 12/);
  });
  it("nordirische Nummern nur bei Lieferungen", () => {
    expect(ustIdProblem("XI123456789", "S")).toMatch(/nur bei Lieferungen/);
    expect(ustIdProblem("XI123456789", "L")).toBeNull();
  });
});

describe("isValidGermanUstId (ISO 7064 MOD 11,10)", () => {
  it("prüft die Prüfziffer", () => {
    expect(isValidGermanUstId("DE136695976")).toBe(true);
    expect(isValidGermanUstId("DE123456788")).toBe(true);
    expect(isValidGermanUstId("DE123456789")).toBe(false);
    expect(isValidGermanUstId("DE12345678")).toBe(false);
    expect(isValidGermanUstId("ATU12345678")).toBe(false);
  });
});

describe("aggregateZm", () => {
  it("summiert je USt-IdNr. und Art, Gutschriften mindern", () => {
    const zeilen = aggregateZm([
      { ustId: "fr 12345678901", art: "S", base: 100_050 },
      { ustId: "FR12345678901", art: "S", base: 200_000 },
      { ustId: "FR12345678901", art: "S", base: -50_000 },
      { ustId: "ATU12345678", art: "S", base: 99 },
      { ustId: "ATU12345678", art: "L", base: 120_000 },
    ]);
    expect(zeilen).toEqual([
      { ustId: "ATU12345678", art: "L", betrag: 120_000 },
      { ustId: "FR12345678901", art: "S", betrag: 250_050 },
    ]);
  });
  it("eine Gutschrift aus einem späteren Quartal ergibt einen negativen Betrag", () => {
    expect(aggregateZm([{ ustId: "ATU12345678", art: "S", base: -30_000 }])).toEqual([{ ustId: "ATU12345678", art: "S", betrag: -30_000 }]);
  });
});

describe("zmEuro", () => {
  it("schneidet Cent ab, auch bei negativen Beträgen", () => {
    expect(zmEuro(250_099)).toBe(2500);
    expect(zmEuro(-250_099)).toBe(-2500);
  });
});

describe("Berichtigung (§ 18a Abs. 10 UStG)", () => {
  const erst: ZmZeile[] = [
    { ustId: "ATU12345678", art: "S", betrag: 100_000 },
    { ustId: "FR12345678901", art: "S", betrag: 200_000 },
  ];
  it("nur geänderte Zeilen mit dem richtigen Betrag, entfallene mit 0", () => {
    const aktuell: ZmZeile[] = [
      { ustId: "ATU12345678", art: "S", betrag: 100_040 },
      { ustId: "FR12345678901", art: "S", betrag: 150_000 },
      { ustId: "NL123456789B01", art: "S", betrag: 70_000 },
    ];
    expect(zmBerichtigung(erst, aktuell)).toEqual([
      { ustId: "FR12345678901", art: "S", betrag: 150_000 },
      { ustId: "NL123456789B01", art: "S", betrag: 70_000 },
    ]);
    expect(zmBerichtigung(erst, [erst[0]!])).toEqual([{ ustId: "FR12345678901", art: "S", betrag: 0 }]);
  });
  it("leer, wenn der Stand beim BZSt stimmt", () => {
    expect(zmBerichtigung(erst, erst)).toEqual([]);
  });
  it("gemeldeter Stand: Berichtigungen ersetzen ihre Zeilen, eine neue Erstmeldung alles", () => {
    const stand = gemeldeterStand([
      { berichtigt: false, zeilen: erst },
      { berichtigt: true, zeilen: [{ ustId: "FR12345678901", art: "S", betrag: 0 }] },
      { berichtigt: true, zeilen: [{ ustId: "NL123456789B01", art: "S", betrag: 5_000 }] },
    ]);
    expect(stand).toEqual([erst[0], { ustId: "NL123456789B01", art: "S", betrag: 5_000 }]);
    expect(
      gemeldeterStand([
        { berichtigt: false, zeilen: erst },
        { berichtigt: false, zeilen: [erst[1]!] },
      ]),
    ).toEqual([erst[1]]);
  });
});

describe("zmFrist (§ 18a Abs. 2 UStG)", () => {
  it("25. Tag nach Ablauf des Quartals", () => {
    expect(zmFrist(2026, 1)).toBe("2026-04-27"); // 25.04.2026 ist ein Samstag
    expect(zmFrist(2026, 2)).toBe("2026-07-27"); // 25.07.2026 ist ein Samstag
    expect(zmFrist(2026, 3)).toBe("2026-10-26"); // 25.10.2026 ist ein Sonntag
    expect(zmFrist(2025, 3)).toBe("2025-10-27");
    expect(zmFrist(2025, 2)).toBe("2025-07-25");
  });
  it("viertes Quartal: 25. Januar des Folgejahres", () => {
    expect(zmFrist(2026, 4)).toBe("2027-01-25");
    expect(zmFrist(2025, 4)).toBe("2026-01-26"); // 25.01.2026 ist ein Sonntag
  });
});

import { describe, expect, it } from "vitest";
import {
  aggregateZm,
  gemeldeterStand,
  isValidGermanUstId,
  normalizeUstId,
  ustIdAufbauProblem,
  ustIdProblem,
  zmBerichtigung,
  zmEuro,
  zmFrist,
  type ZmZeile,
} from "./zm.ts";

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

// Aufbau laut BZSt, „Aufbau der USt-IdNr. in den EU-Mitgliedstaaten“ (Stand 12.12.2025), auf die UStAE 18e.2 verweist
describe("ustIdAufbauProblem: Aufbau je Mitgliedstaat (#1413)", () => {
  it.each([
    ["AT", ["ATU12345678"], ["ATU1234", "AT12345678", "ATU1234567X"]],
    ["BE", ["BE0123456789", "BE1123456789"], ["BE123456789", "BE01234567890"]],
    ["BG", ["BG123456789", "BG1234567890"], ["BG12345678", "BG12345678901"]],
    ["CY", ["CY12345678L"], ["CY123456789", "CY1234567L"]],
    ["CZ", ["CZ12345678", "CZ123456789", "CZ1234567890"], ["CZ1234567", "CZ12345678901"]],
    ["DK", ["DK12345678"], ["DK1234567", "DK123456789"]],
    ["EE", ["EE123456789"], ["EE12345678", "EE1234567890"]],
    ["EL", ["EL123456789"], ["EL12345678", "EL1234567890"]],
    ["ES", ["ESX1234567L", "ESB12345678", "ES12345678Z", "ES123456789"], ["ES1234567", "ES12A456789", "ES1234567890"]],
    ["FI", ["FI12345678"], ["FI1234567", "FI123456789"]],
    ["FR", ["FR12345678901", "FRAB123456789", "FR1A123456789"], ["FR1234567890", "FR12A45678901", "FR123456789012"]],
    ["HR", ["HR12345678901"], ["HR1234567890", "HR123456789012"]],
    ["HU", ["HU12345678"], ["HU1234567", "HU123456789"]],
    ["IE", ["IE1234567A", "IE1A23456B", "IE1+23456B", "IE1234567FA"], ["IE12345678", "IE1234567", "IE1234567XZ", "IE1234567AJ"]],
    ["IT", ["IT12345678901"], ["IT1234567890", "IT123456789012"]],
    ["LT", ["LT123456789", "LT123456789012"], ["LT1234567890", "LT12345678"]],
    ["LU", ["LU12345678"], ["LU1234567", "LU123456789"]],
    ["LV", ["LV12345678901"], ["LV1234567890", "LV123456789012"]],
    ["MT", ["MT12345678"], ["MT1234567", "MT123456789"]],
    ["NL", ["NL123456789B01", "NL12345678*+AB"], ["NL123456789B1", "NL1234567890"]],
    ["PL", ["PL1234567890"], ["PL123456789", "PL12345678901"]],
    ["PT", ["PT123456789"], ["PT12345678", "PT1234567890"]],
    ["RO", ["RO12345", "RO1234567890"], ["RO01234567", "RO12345678901"]],
    ["SE", ["SE123456789001"], ["SE123456789012", "SE1234567801"]],
    ["SI", ["SI12345678"], ["SI1234567", "SI123456789"]],
    ["SK", ["SK1234567890"], ["SK123456789", "SK12345678901"]],
    ["XI", ["XI123456789", "XI123456789012", "XIGD001", "XIHA500"], ["XI12345678", "XI1234567890", "XIAB123"]],
  ])("%s", (land, gueltig, falsch) => {
    for (const id of gueltig) expect(ustIdAufbauProblem(id), id).toBeNull();
    for (const id of falsch) expect(ustIdAufbauProblem(id), id).toMatch(new RegExp(`^${id.replace(/[+*]/g, "\\$&")}: .*${land}`));
  });

  // Revenue, Tax and Duty Manual „Filing and paying Stamp Duty on Instruments“, Kapitel 3, Abschnitte 1.2.1 und 1.2.3: Ältere
  // PPS-Nummern verheirateter Frauen haben an neunter Stelle ein W, und die Steuernummer eines Einzelunternehmers ist seine
  // PPS-Nummer (revenue.ie, „What is a Tax Reference Number?“). Das BZSt nennt an neunter Stelle nur A bis I.
  it("nimmt eine irische Nummer mit W an neunter Stelle an (ältere PPS-Nummer einer verheirateten Frau)", () => {
    expect(ustIdAufbauProblem("IE1234567AW")).toBeNull();
  });

  it("nennt den Aufbau, den das Land vorgibt", () => {
    expect(ustIdAufbauProblem("ATU1234")).toBe("ATU1234: eine USt-IdNr. aus Österreich hat nach AT ein U und acht Ziffern");
    expect(ustIdAufbauProblem("BE123456789")).toMatch(/zehn Ziffern; einer alten neunstelligen wird eine 0 vorangestellt/);
  });

  it("überlässt fehlende, deutsche und fremde Kennzeichen ustIdProblem, das wie ERiC den Aufbau nicht prüft", () => {
    for (const id of ["", "DE123456788", "GB123456789", "CH123456789"]) expect(ustIdAufbauProblem(id), id).toBeNull();
    expect(ustIdProblem("ATU1234", "L")).toBeNull();
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

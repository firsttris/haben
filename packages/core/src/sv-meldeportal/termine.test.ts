import { describe, expect, it } from "vitest";
import { abmeldungFrist, anmeldungFrist, beitragstermine, istBankarbeitstag, jahresmeldungFrist } from "./index.ts";

/*
 * Erwartungswerte Beitragsnachweis und Fälligkeit: TK-Beratungsblatt „Beitragsnachweis“ (305008 07/2026, Seite 4,
 * Fälligkeitstermine 2026), https://www.tk.de/resource/blob/2032950/db10bad9264a10f8b84f84a1edd9ee10/beratungsblatt-beitragsnachweis-data.pdf.
 * Die TK sitzt in Hamburg; in keinem der Monate liegt ein Feiertag eines anderen Landes in den letzten Bankarbeitstagen,
 * daher passt die Tabelle auch zur Regel mit den Feiertagen aller Länder.
 */
const TK_2026: [monat: number, nachweisVorliegen: string, faelligkeit: string][] = [
  [1, "2026-01-26", "2026-01-28"],
  [2, "2026-02-23", "2026-02-25"],
  [3, "2026-03-25", "2026-03-27"],
  [4, "2026-04-24", "2026-04-28"],
  [5, "2026-05-22", "2026-05-27"],
  [6, "2026-06-24", "2026-06-26"],
  [7, "2026-07-27", "2026-07-29"],
  [8, "2026-08-25", "2026-08-27"],
  [9, "2026-09-24", "2026-09-28"],
  [10, "2026-10-26", "2026-10-28"],
  [11, "2026-11-24", "2026-11-26"],
  [12, "2026-12-22", "2026-12-28"],
];

describe("Bankarbeitstage", () => {
  it("kennt Wochenende, Feiertage, Heiligabend und Silvester", () => {
    expect(istBankarbeitstag("2026-11-27")).toBe(true);
    expect(istBankarbeitstag("2026-11-28")).toBe(false);
    expect(istBankarbeitstag("2026-05-25")).toBe(false); // Pfingstmontag
    expect(istBankarbeitstag("2026-12-24")).toBe(false);
    expect(istBankarbeitstag("2026-12-31")).toBe(false);
  });

  it("nimmt Feiertage jedes Landes, weil der Sitz der Einzugsstelle unbekannt ist", () => {
    // Fronleichnam 2027 (27. Mai) gilt nur in sechs Ländern, Reformationstag 2025 (Freitag) in neun
    expect(istBankarbeitstag("2027-05-27")).toBe(false);
    expect(istBankarbeitstag("2025-10-31")).toBe(false);
  });
});

describe("Beitragsnachweis und Fälligkeit (§ 23 Abs. 1, § 28f Abs. 3 SGB IV)", () => {
  it.each(TK_2026)("Monat %i: Nachweis liegt am %s um 0 Uhr vor, Beiträge fällig am %s", (monat, vorliegen, faellig) => {
    const t = beitragstermine(2026, monat);
    expect(t.nachweisVorliegen).toBe(vorliegen);
    expect(t.faelligkeit).toBe(faellig);
  });

  it("verlangt die Übermittlung am Vortag, weil der Nachweis um 0 Uhr vorliegen muss", () => {
    expect(beitragstermine(2026, 11).nachweisBis).toBe("2026-11-23");
    // Vorliegen am Montag, 26. Januar: übermitteln bis Sonntag
    expect(beitragstermine(2026, 1).nachweisBis).toBe("2026-01-25");
  });

  it("zieht die Fälligkeit vor, wenn ein Feiertag eines Landes in den letzten Tagen liegt", () => {
    // Mai 2027: 31. Mo, 28. Fr, 27. Fronleichnam (nur einige Länder), 26. Mi → drittletzter Bankarbeitstag 26. statt 27. Mai
    expect(beitragstermine(2027, 5).faelligkeit).toBe("2027-05-26");
  });
});

describe("DEÜV-Fristen", () => {
  it("Anmeldung mit der ersten folgenden Abrechnung, spätestens sechs Wochen nach Beginn (§ 6 DEÜV)", () => {
    expect(anmeldungFrist("2026-11-01", [])).toBe("2026-12-13");
    expect(anmeldungFrist("2026-11-01", ["2026-10-30", "2026-11-30"])).toBe("2026-11-30");
    // Ein Zahltag nach den sechs Wochen ändert nichts
    expect(anmeldungFrist("2026-11-01", ["2027-01-29"])).toBe("2026-12-13");
  });

  it("Abmeldung mit der nächsten folgenden Abrechnung, spätestens sechs Wochen nach dem Ende (§ 8 Abs. 1 DEÜV)", () => {
    expect(abmeldungFrist("2026-11-30", [])).toBe("2027-01-11");
    // Der Zahltag am Ende selbst folgt nicht nach
    expect(abmeldungFrist("2026-11-30", ["2026-11-30", "2026-12-30"])).toBe("2026-12-30");
  });

  it("Jahresmeldung mit der ersten Abrechnung im neuen Jahr, spätestens am 15. Februar (§ 10 Abs. 1 DEÜV)", () => {
    expect(jahresmeldungFrist(2026, [])).toBe("2027-02-15");
    expect(jahresmeldungFrist(2026, ["2026-12-30", "2027-01-29"])).toBe("2027-01-29");
  });
});

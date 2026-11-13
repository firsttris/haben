import { describe, expect, it } from "vitest";
import { freieBuchungIssues, freieBuchungPosting } from "./freie-buchung.ts";
import { kennzahlenAusJournal } from "./journal-kennzahlen.ts";
import { datevFormelKonto, euerAusZeilen, euerZuordnung } from "./journal-euer.ts";
import { kontoImKontenrahmen } from "./kontenrahmen-wechsel.ts";
import { manualPostingIssues, reverseManualPosting, type ManualLine } from "./manual.ts";

/* Freie Buchungen mit Steuerschlüssel (#502; docs/adr/journal-als-quelle.md, Entscheidung 4) */

const K = {
  SKR03: { privat: "1800", erloese19: "8400", erloese7: "8300", ust19: "1776", ust7: "1771", gesellschafter: "0730", aufwand: "4900", bank: "1200" },
  SKR04: { privat: "2100", erloese19: "4400", erloese7: "4300", ust19: "3806", ust7: "3801", gesellschafter: "3510", aufwand: "6300", bank: "1800" },
} as const;

const kontext = (kontenrahmen: "SKR03" | "SKR04", rechtsform: "einzelunternehmen" | "gmbh" = "einzelunternehmen") => ({
  kontenrahmen,
  rechtsform,
  kleinunternehmer: false,
  ausDemJournal: true,
});

for (const kr of ["SKR03", "SKR04"] as const) {
  const k = K[kr];
  const entnahme: ManualLine[] = [
    { account: k.privat, debit: 11_900, credit: 0 },
    { account: k.erloese19, debit: 0, credit: 11_900, taxCode: "USt19" },
  ];

  describe(kr, () => {
    it("teilt brutto in Netto und Steuer, beide mit dem Schlüssel; Voranmeldung und EÜR zählen sie", () => {
      expect(manualPostingIssues(entnahme, kr, "einzelunternehmen")).toEqual([]);
      expect(freieBuchungIssues(entnahme, kontext(kr))).toEqual([]);
      const zeilen = freieBuchungPosting(entnahme, kr);
      expect(zeilen).toEqual([
        { account: k.privat, debit: 11_900, credit: 0, taxCode: null },
        { account: k.erloese19, debit: 0, credit: 10_000, taxCode: "USt19" },
        { account: k.ust19, debit: 0, credit: 1_900, taxCode: "USt19" },
      ]);
      const va = kennzahlenAusJournal(kr, "ist", [zeilen]);
      expect({ kz81: va.kz81, tax81: va.tax81 }).toEqual({ kz81: 10_000, tax81: 1_900 });
      expect(euerAusZeilen(kr, zeilen).zeilen).toEqual({ einnahmenSteuerpflichtig: 10_000, vereinnahmteUst: 1_900 });
    });

    it("rundet die Steuer kaufmännisch (7 %: 10,00 € brutto → 0,65 €)", () => {
      const lines: ManualLine[] = [
        { account: k.privat, debit: 1_000, credit: 0 },
        { account: k.erloese7, debit: 0, credit: 1_000, taxCode: "USt7" },
      ];
      expect(freieBuchungPosting(lines, kr).map((l) => [l.account, l.credit])).toEqual([
        [k.privat, 0],
        [k.erloese7, 935],
        [k.ust7, 65],
      ]);
    });

    it("Storno dreht Soll und Haben und behält die Schlüssel: die Kennzahlen heben sich auf", () => {
      const zeilen = freieBuchungPosting(entnahme, kr);
      const va = kennzahlenAusJournal(kr, "soll", [zeilen, reverseManualPosting(zeilen)]);
      expect({ kz81: va.kz81, tax81: va.tax81 }).toEqual({ kz81: 0, tax81: 0 });
      expect(reverseManualPosting([{ account: k.ust19, debit: 0, credit: 0, taxCode: "USt19", basis: 500 }])[0]!.basis).toBe(-500);
    });

    it("lehnt ab: Schlüssel auf einem anderen Konto, ohne Stichjahr, als Kleinunternehmer, Gegenkonto Bank", () => {
      const falsch: ManualLine[] = [entnahme[0]!, { ...entnahme[1]!, account: k.erloese7 }];
      expect(manualPostingIssues(falsch, kr, "einzelunternehmen")).toContain(
        `Zeile 2: Mit USt19 bucht die Zeile auf ${k.erloese19} oder ${kr === "SKR03" ? "8910" : "4620"}`,
      );
      expect(freieBuchungIssues(entnahme, { ...kontext(kr), ausDemJournal: false })[0]).toMatch(/erst ab dem Stichjahr/);
      expect(freieBuchungIssues(entnahme, { ...kontext(kr), kleinunternehmer: true })).toContain(
        "Als Kleinunternehmer bucht Haben keine Umsatzsteuer (§ 19 Abs. 1 UStG)",
      );
      const bank: ManualLine[] = [{ ...entnahme[0]!, account: k.bank }, entnahme[1]!];
      expect(manualPostingIssues(bank, kr, "einzelunternehmen").join()).toMatch(/Nebenbuch Bank/);
    });

    it("GmbH: Gegenkonto Gesellschafter-Verrechnungskonto, Privat nicht; ohne Schlüssel vor dem Stichjahr wie bisher", () => {
      const gesellschafter: ManualLine[] = [{ ...entnahme[0]!, account: k.gesellschafter }, entnahme[1]!];
      expect(manualPostingIssues(gesellschafter, kr, "gmbh")).toEqual([]);
      expect(freieBuchungIssues(gesellschafter, kontext(kr, "gmbh"))).toEqual([]);
      expect(manualPostingIssues(entnahme, kr, "gmbh").join()).toMatch(/Privatkonto/);
      const umbuchung: ManualLine[] = [
        { account: k.aufwand, debit: 100, credit: 0 },
        { account: k.gesellschafter, debit: 0, credit: 100 },
      ];
      expect(freieBuchungIssues(umbuchung, { ...kontext(kr, "gmbh"), ausDemJournal: false })).toEqual([]);
    });

    it("Einzelunternehmen: neben einem Erfolgskonto nur Privat; jedes Erfolgskonto mit Zeile der EÜR", () => {
      const ausgabe: ManualLine[] = [
        { account: k.aufwand, debit: 2_000, credit: 0 },
        { account: k.privat, debit: 0, credit: 2_000 },
      ];
      expect(freieBuchungIssues(ausgabe, kontext(kr))).toEqual([]);
      const gegenGesellschafter: ManualLine[] = [ausgabe[0]!, { ...ausgabe[1]!, account: k.gesellschafter }];
      expect(freieBuchungIssues(gegenGesellschafter, kontext(kr)).join()).toMatch(/nur ein Privatkonto/);
    });
  });
}

describe("Sachentnahme (§ 3 Abs. 1b UStG) als freie Buchung", () => {
  const SACH = { SKR03: { 1900: "8910", 700: "8915", privat: "1800" }, SKR04: { 1900: "4620", 700: "4610", privat: "2100" } } as const;
  for (const kr of ["SKR03", "SKR04"] as const) {
    it(`${kr}: Kz 81 bzw. 86 und eigene Zeile der EÜR, die Steuer als Umsatzsteuer auf unentgeltliche Wertabgaben`, () => {
      const lines: ManualLine[] = [
        { account: SACH[kr].privat, debit: 11_900, credit: 0 },
        { account: SACH[kr][1900], debit: 0, credit: 11_900, taxCode: "USt19" },
      ];
      expect(manualPostingIssues(lines, kr, "einzelunternehmen")).toEqual([]);
      expect(freieBuchungIssues(lines, kontext(kr))).toEqual([]);
      const zeilen = freieBuchungPosting(lines, kr);
      const va = kennzahlenAusJournal(kr, "ist", [zeilen]);
      expect({ kz81: va.kz81, tax81: va.tax81 }).toEqual({ kz81: 10_000, tax81: 1_900 });
      expect(euerAusZeilen(kr, zeilen).zeilen).toEqual({ sachentnahmen: 10_000, vereinnahmteUst: 1_900 });
      const sieben: ManualLine[] = [
        { account: SACH[kr].privat, debit: 1_070, credit: 0 },
        { account: SACH[kr][700], debit: 0, credit: 1_070, taxCode: "USt7" },
      ];
      const va7 = kennzahlenAusJournal(kr, "soll", [freieBuchungPosting(sieben, kr)]);
      expect({ kz86: va7.kz86, tax86: va7.tax86 }).toEqual({ kz86: 1_000, tax86: 70 });
    });

    it(`${kr}: ohne Steuerschlüssel oder mit dem anderen Satz nicht buchbar`, () => {
      const ohne: ManualLine[] = [
        { account: SACH[kr].privat, debit: 100, credit: 0 },
        { account: SACH[kr][1900], debit: 0, credit: 100 },
      ];
      expect(manualPostingIssues(ohne, kr, "einzelunternehmen").join()).toMatch(/Sachentnahme mit Umsatzsteuer und bucht nur mit Steuerschlüssel/);
      const falsch: ManualLine[] = [
        { account: SACH[kr].privat, debit: 100, credit: 0 },
        { account: SACH[kr][700], debit: 0, credit: 100, taxCode: "USt19" },
      ];
      expect(manualPostingIssues(falsch, kr, "einzelunternehmen").join()).toMatch(new RegExp(`Mit USt19 bucht die Zeile auf \\d{4} oder ${SACH[kr][1900]}`));
    });
  }

  it("Kontenrahmenwechsel: die Sachentnahme hat in beiden Rahmen ihr Konto", () => {
    expect(kontoImKontenrahmen("SKR03", "SKR04", "8910")).toBe("4620");
    expect(kontoImKontenrahmen("SKR04", "SKR03", "4610")).toBe("8915");
    expect(kontoImKontenrahmen("SKR03", "SKR04", "8915")).toBe("4610");
  });
});

describe("Sachentnahme 7 % in SKR04: 4610, früher 4630", () => {
  // DATEV SKR04 4630 ist „Verwendung von Gegenständen für Zwecke außerhalb des Unternehmens 7 % USt“, die Entnahme von
  // Waren zu 7 % ist 4610 (DATEV-Kontenrahmen SKR04 Art.-Nr. 11175, gültig für 2026); SKR03 4630 sind Geschenke. Bis
  // #598 buchte Haben die Sachentnahme 7 % in SKR04 auf 4630: Gebuchtes zählt weiter, neu gebucht wird nur 4610.
  it("SKR03 4630 bleibt Geschenke, die Sachentnahme 7 % ist SKR04 4610, 4630 zählt weiter als Sachentnahme", () => {
    expect(kontoImKontenrahmen("SKR03", "SKR04", "4630")).toBe("6610");
    expect(euerZuordnung("SKR03", "4630")).toBe("ausgabe:geschenke");
    expect(euerZuordnung("SKR04", "4610")).toBe("sachentnahmen");
    expect(euerZuordnung("SKR04", "4630")).toBe("sachentnahmen");
    expect(kontoImKontenrahmen("SKR04", "SKR03", "4630")).toBe("8915");
    expect(kontoImKontenrahmen("SKR03", "SKR04", "8915")).toBe("4610");
    expect(datevFormelKonto("SKR04", "4630")).toBe(true);
    for (const [kr, konto] of [
      ["SKR03", "8910"],
      ["SKR04", "4620"],
      ["SKR04", "4610"],
    ] as const)
      expect(datevFormelKonto(kr, konto)).toBe(true);
  });
});

describe("SKR04 4630 neu buchen", () => {
  it("geht nicht mehr, auch nicht mit Steuerschlüssel", () => {
    const zeilen = (taxCode: "USt7" | null) => [
      { account: "2100", debit: 1_070, credit: 0, taxCode: null },
      { account: "4630", debit: 0, credit: 1_070, taxCode },
    ];
    expect(manualPostingIssues(zeilen("USt7"), "SKR04", "einzelunternehmen").join(" ")).toContain("4610");
    expect(manualPostingIssues(zeilen(null), "SKR04", "einzelunternehmen").join(" ")).toContain("Konto 4630");
  });
});

import { describe, expect, it } from "vitest";
import { freieBuchungIssues, freieBuchungPosting } from "./freie-buchung.ts";
import { kennzahlenAusJournal } from "./journal-kennzahlen.ts";
import { euerAusZeilen } from "./journal-euer.ts";
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
      expect(manualPostingIssues(falsch, kr, "einzelunternehmen")).toContain(`Zeile 2: Mit USt19 bucht die Zeile auf ${k.erloese19}`);
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

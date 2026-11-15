import { describe, expect, it } from "vitest";
import { ACCOUNTS, verrechnungPosting } from "./posting.ts";

describe("verrechnungPosting: eine Seite einer Verrechnung zweier Belege", () => {
  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    const k = ACCOUNTS[kontenrahmen];

    it(`${kontenrahmen}: die Rechnung bucht Soll Verbindlichkeiten an das Verrechnungskonto`, () => {
      // Zeile der Rechnung in document_settlements: negativ, die Verbindlichkeit sinkt
      expect(verrechnungPosting(-5_950, kontenrahmen)).toEqual([
        { account: k.verbindlichkeiten, debit: 5_950, credit: 0, taxCode: null },
        { account: k.verrechnung, debit: 0, credit: 5_950, taxCode: null },
      ]);
    });

    it(`${kontenrahmen}: die Gutschrift bucht Soll Verrechnungskonto an Verbindlichkeiten`, () => {
      // Zeile der Gutschrift: positiv, ihr Soll-Saldo auf den Verbindlichkeiten sinkt
      expect(verrechnungPosting(5_950, kontenrahmen)).toEqual([
        { account: k.verbindlichkeiten, debit: 0, credit: 5_950, taxCode: null },
        { account: k.verrechnung, debit: 5_950, credit: 0, taxCode: null },
      ]);
    });

    it(`${kontenrahmen}: beide Seiten zusammen stehen auf null, ohne Steuerzeile`, () => {
      const seiten = [...verrechnungPosting(-5_950, kontenrahmen), ...verrechnungPosting(5_950, kontenrahmen)];
      expect(seiten.reduce((s, l) => s + l.debit, 0)).toBe(seiten.reduce((s, l) => s + l.credit, 0));
      // Jede Seite gegen die andere: Verbindlichkeiten und Verrechnungskonto stehen danach auf null
      for (const account of [k.verbindlichkeiten, k.verrechnung]) {
        expect(seiten.filter((l) => l.account === account).reduce((s, l) => s + l.debit - l.credit, 0)).toBe(0);
      }
      expect(seiten.every((l) => l.taxCode === null)).toBe(true);
    });
  }
});

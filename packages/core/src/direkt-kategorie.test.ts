import { describe, expect, it } from "vitest";
import { computeEuer } from "./euer.ts";
import {
  direktKategorienFuer,
  kategorieAnteil,
  kategorieArt,
  kategorieFehler,
  kategoriePosting,
  kategorieText,
  type KategorieAngabe,
} from "./direkt-kategorie.ts";

/*
 * Direkt buchen mit Kategorie und Steuersatz (Roadmap Platz 1, #324): ein Bankumsatz ohne Beleg auf eine Einnahme- oder
 * Ausgabekategorie. Beispiel aus dem Issue: Zahlung eines Privatkunden über 119,00 € mit 19 %, SKR03 8400.
 */

const balanced = (lines: { debit: number; credit: number }[]) => lines.reduce((s, l) => s + l.debit, 0) === lines.reduce((s, l) => s + l.credit, 0);

const erloese19: KategorieAngabe = { kategorie: "erloese", steuersatz: 1900 };

describe("kategorieFehler", () => {
  it("Einnahme mit 19 % oder 7 % ist buchbar, mit anderem Satz nicht", () => {
    expect(kategorieFehler(erloese19, false)).toBeNull();
    expect(kategorieFehler({ kategorie: "erloese", steuersatz: 700 }, false)).toBeNull();
    expect(kategorieFehler({ kategorie: "erloese", steuersatz: 1600 }, false)).toMatch(/19 % oder 7 %/);
    // Steuerfrei, Reverse Charge, Ausfuhr: nur mit Rechnung (Pflichtangaben, Zusammenfassende Meldung)
    expect(kategorieFehler({ kategorie: "erloese", steuersatz: 0 }, false)).toMatch(/Rechnung/);
  });

  it("Kleinunternehmer buchen Einnahmen ohne Umsatzsteuer (§ 19 UStG)", () => {
    expect(kategorieFehler({ kategorie: "erloese", steuersatz: 0 }, true)).toBeNull();
    expect(kategorieFehler(erloese19, true)).toMatch(/Kleinunternehmer/);
  });

  it("Ausgaben ohne Beleg haben keine Vorsteuer (§ 15 Abs. 1 Satz 1 Nr. 1 Satz 2 UStG)", () => {
    expect(kategorieFehler({ kategorie: "telefon", steuersatz: 0 }, false)).toBeNull();
    expect(kategorieFehler({ kategorie: "telefon", steuersatz: 1900 }, false)).toMatch(/Vorsteuer/);
  });

  it("lehnt Kategorien ab, die einen Beleg oder ein Verzeichnis brauchen, und unbekannte", () => {
    for (const kategorie of ["anlage", "hardware", "einfuhrumsatzsteuer", "bewirtung", "geschenke"]) {
      expect(kategorieFehler({ kategorie: kategorie as KategorieAngabe["kategorie"], steuersatz: 0 }, false)).toMatch(/Beleg/);
    }
    expect(kategorieFehler({ kategorie: "gibtsnicht" as KategorieAngabe["kategorie"], steuersatz: 0 }, false)).toMatch(/Kategorie/);
  });
});

describe("direktKategorienFuer", () => {
  it("Einnahmen und die Ausgabekategorien, die ohne Beleg gehen", () => {
    const keys = direktKategorienFuer().map((k) => k.value);
    expect(keys[0]).toBe("erloese");
    expect(keys).toContain("telefon");
    expect(keys).toContain("sonstiges");
    expect(keys).not.toContain("anlage");
    expect(keys).not.toContain("bewirtung");
    // Bankgebühren gibt es schon als eigene Art unter „Direkt buchen“
    expect(keys).not.toContain("geldverkehr");
    expect(kategorieArt("erloese")).toBe("einnahme");
    expect(kategorieArt("telefon")).toBe("ausgabe");
  });
});

describe("kategorieAnteil", () => {
  it("rechnet Netto und Steuer aus dem Bruttobetrag, ein Storno hebt sich genau auf", () => {
    expect(kategorieAnteil(erloese19, 119_00)).toEqual({ base: 100_00, tax: 19_00 });
    expect(kategorieAnteil({ kategorie: "erloese", steuersatz: 700 }, 10_70)).toEqual({ base: 10_00, tax: 70 });
    // 9,99 € zu 19 %: Steuer 1,60 €, Netto 8,39 €
    expect(kategorieAnteil(erloese19, 9_99)).toEqual({ base: 8_39, tax: 1_60 });
    expect(kategorieAnteil(erloese19, -9_99)).toEqual({ base: -8_39, tax: -1_60 });
    expect(kategorieAnteil({ kategorie: "erloese", steuersatz: 0 }, 50_00)).toEqual({ base: 50_00, tax: 0 });
    expect(kategorieAnteil({ kategorie: "telefon", steuersatz: 0 }, -35_70)).toEqual({ base: -35_70, tax: 0 });
  });
});

describe("kategoriePosting", () => {
  it("Zahlung eines Privatkunden mit 19 %, SKR03: Bank an Erlöse und Umsatzsteuer (fällig, Ist wie Soll)", () => {
    const lines = kategoriePosting(erloese19, 119_00, "SKR03");
    expect(lines).toEqual([
      { account: "1200", debit: 119_00, credit: 0, taxCode: null },
      { account: "8400", debit: 0, credit: 100_00, taxCode: "USt19" },
      { account: "1776", debit: 0, credit: 19_00, taxCode: "USt19" },
    ]);
    expect(balanced(lines)).toBe(true);
  });

  it("SKR04 mit 7 %", () => {
    expect(kategoriePosting({ kategorie: "erloese", steuersatz: 700 }, 10_70, "SKR04")).toEqual([
      { account: "1800", debit: 10_70, credit: 0, taxCode: null },
      { account: "4300", debit: 0, credit: 10_00, taxCode: "USt7" },
      { account: "3801", debit: 0, credit: 70, taxCode: "USt7" },
    ]);
  });

  it("Erstattung an einen Privatkunden (Ausgang) dreht die Seiten und mindert die Umsatzsteuer", () => {
    expect(kategoriePosting(erloese19, -119_00, "SKR03")).toEqual([
      { account: "1200", debit: 0, credit: 119_00, taxCode: null },
      { account: "8400", debit: 100_00, credit: 0, taxCode: "USt19" },
      { account: "1776", debit: 19_00, credit: 0, taxCode: "USt19" },
    ]);
  });

  it("Kleinunternehmer: Erlöse nach § 19 UStG ohne Steuer", () => {
    expect(kategoriePosting({ kategorie: "erloese", steuersatz: 0 }, 50_00, "SKR03")).toEqual([
      { account: "1200", debit: 50_00, credit: 0, taxCode: null },
      { account: "8195", debit: 0, credit: 50_00, taxCode: "KU" },
    ]);
    expect(kategoriePosting({ kategorie: "erloese", steuersatz: 0 }, 50_00, "SKR04").map((l) => l.account)).toEqual(["1800", "4185"]);
  });

  it("Ausgabe auf eine Kategorie: Aufwand brutto an Bank, ohne Vorsteuer", () => {
    expect(kategoriePosting({ kategorie: "telefon", steuersatz: 0 }, -35_70, "SKR03")).toEqual([
      { account: "1200", debit: 0, credit: 35_70, taxCode: null },
      { account: "4920", debit: 35_70, credit: 0, taxCode: "keineVSt" },
    ]);
    expect(kategoriePosting({ kategorie: "telefon", steuersatz: 0 }, -35_70, "SKR04").map((l) => l.account)).toEqual(["1800", "6805"]);
  });

  it("wirft bei einer Angabe, die nicht buchbar ist", () => {
    expect(() => kategoriePosting({ kategorie: "telefon", steuersatz: 1900 }, -119_00, "SKR03")).toThrow(/Vorsteuer/);
  });
});

describe("kategorieText", () => {
  it("nennt Kategorie und Steuersatz", () => {
    expect(kategorieText(erloese19)).toBe("Erlöse 19 %");
    expect(kategorieText({ kategorie: "erloese", steuersatz: 0 })).toBe("Erlöse (Kleinunternehmer)");
    expect(kategorieText({ kategorie: "telefon", steuersatz: 0 })).toBe("Telefon");
  });
});

describe("EÜR", () => {
  it("Einnahme: netto als steuerpflichtige Betriebseinnahme, Steuer als vereinnahmte Umsatzsteuer; Storno hebt auf", () => {
    const euer = computeEuer(2026, [
      { kind: "kategorie", date: "2026-03-10", amount: 119_00, kategorie: "erloese", steuersatz: 1900, group: "a" },
      { kind: "kategorie", date: "2026-03-11", amount: 10_70, kategorie: "erloese", steuersatz: 700, group: "b" },
      { kind: "kategorie", date: "2026-04-01", amount: 50_00, kategorie: "erloese", steuersatz: 1900, group: "c" },
      { kind: "kategorie", date: "2026-04-01", amount: -50_00, kategorie: "erloese", steuersatz: 1900, group: "c" },
    ]);
    expect(euer.einnahmen.find((l) => l.key === "einnahmenSteuerpflichtig")?.amount).toBe(110_00);
    expect(euer.einnahmen.find((l) => l.key === "vereinnahmteUst")?.amount).toBe(19_70);
    expect(euer.monthly.einnahmen[2]).toBe(110_00);
    expect(euer.gewinn).toBe(129_70);
  });

  it("Kleinunternehmer: Einnahme ohne Umsatzsteuer", () => {
    const euer = computeEuer(2026, [{ kind: "kategorie", date: "2026-03-10", amount: 50_00, kategorie: "erloese", steuersatz: 0 }]);
    expect(euer.einnahmen.find((l) => l.key === "einnahmenKleinunternehmer")?.amount).toBe(50_00);
    expect(euer.einnahmen.find((l) => l.key === "vereinnahmteUst")?.amount).toBe(0);
  });

  it("Ausgabe: brutto auf der Zeile der Kategorie, ohne Vorsteuer; eine Erstattung mindert sie", () => {
    const euer = computeEuer(2026, [
      { kind: "kategorie", date: "2026-05-02", amount: -35_70, kategorie: "telefon", steuersatz: 0 },
      { kind: "kategorie", date: "2026-05-20", amount: 5_70, kategorie: "telefon", steuersatz: 0 },
    ]);
    expect(euer.ausgaben.find((l) => l.key === "ausgabe:telefon")?.amount).toBe(30_00);
    expect(euer.ausgaben.find((l) => l.key === "vorsteuer")?.amount).toBe(0);
    expect(euer.monthly.ausgaben[4]).toBe(30_00);
    expect(euer.gewinn).toBe(-30_00);
  });
});

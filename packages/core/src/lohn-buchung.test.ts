import { describe, expect, it } from "vitest";
import { ASSET_ACCOUNTS } from "./afa.ts";
import { ebilanzPosition } from "./ebilanz.ts";
import { postenForSaldo, postenOf } from "./hgb.ts";
import { lohnabrechnung, type LohnStammdaten } from "./lohnabrechnung/index.ts";
import { LOHN_KONTEN, lohnBuchung, lohnStornoBuchung, type LohnBuchungsAbrechnung } from "./lohn-buchung.ts";
import { ledgerManagedAccounts, manualPostingIssues } from "./manual.ts";
import { PAUSCHALE_KONTEN } from "./pauschalen.ts";
import { ACCOUNTS, EXPENSE_CATEGORIES, type Kontenrahmen, type PostingLine } from "./posting.ts";
import { carriesForward } from "./vortrag.ts";

/*
 * Buchung einer festgeschriebenen Lohnabrechnung (docs/lohn-plan.md, PR 4). Konten aus dem DATEV-Kontenrahmen 2026
 * (SKR03 Art.-Nr. 11174, SKR04 Art.-Nr. 11175). Die Beträge kommen aus lohnabrechnung(); die Lohnsteuer des
 * Geschäftsführers (1.289,33 €) ist die des BMF-Steuerrechners (lohnabrechnung.test.ts).
 */

const GGF: LohnStammdaten = {
  art: "ggf",
  monatsgehalt: 6000_00,
  eintritt: "2024-01-01",
  austritt: null,
  steuerklasse: 1,
  faktor: 1000,
  kinderfreibetraege: 0,
  konfession: "ev",
  kv: { art: "gesetzlich", zusatzbeitrag: 290 },
  pflege: { kinderlosenzuschlag: true, kinderUnter25: 0 },
  umlagen: { u1: null, u2: 0 },
  minijob: { rvBefreit: false, pauschsteuer: true },
};
const MINIJOB: LohnStammdaten = { ...GGF, art: "minijob", monatsgehalt: 603_00, konfession: null, umlagen: { u1: 80, u2: 22 } };
const ANGESTELLT: LohnStammdaten = {
  ...GGF,
  art: "beschaeftigt",
  monatsgehalt: 4000_00,
  konfession: null,
  kv: { art: "gesetzlich", zusatzbeitrag: 310 },
  pflege: { kinderlosenzuschlag: false, kinderUnter25: 4 },
  umlagen: { u1: 160, u2: 44 },
};

function abrechnung(stammdaten: LohnStammdaten): LohnBuchungsAbrechnung {
  const r = lohnabrechnung({ jahr: 2026, monat: 10, bundesland: "HB", stammdaten });
  if (!r.ok) throw new Error(r.meldung);
  return {
    art: stammdaten.art,
    brutto: r.brutto,
    lohnsteuer: r.lohnsteuer,
    soli: r.soli,
    kirchensteuer: r.kirchensteuer,
    svArbeitnehmer: r.sv.arbeitnehmer,
    svArbeitgeber: r.sv.arbeitgeber,
    pauschsteuer: r.sv.pauschsteuer,
    netto: r.netto,
    auszahlung: r.auszahlung,
  };
}

const zeilen = (lines: PostingLine[]) => lines.map((l) => [l.account, l.debit, l.credit]);

function buche(a: LohnBuchungsAbrechnung, kontenrahmen: Kontenrahmen, rechtsform: "gmbh" | "einzelunternehmen" = "gmbh") {
  const r = lohnBuchung(a, kontenrahmen, rechtsform);
  if (!r.ok) throw new Error(r.meldung);
  return r.lines;
}

describe("Lohnbuchung je Abrechnung", () => {
  it("SKR03: Gesellschafter-Geschäftsführer, Aufwand brutto an Auszahlung und Lohnsteuer, Soli, Kirchensteuer", () => {
    expect(zeilen(buche(abrechnung(GGF), "SKR03"))).toEqual([
      ["4124", 6000_00, 0],
      ["1740", 0, 4594_64],
      ["1741", 0, 1289_33 + 116_03],
    ]);
  });

  it("SKR04: Gesellschafter-Geschäftsführer", () => {
    expect(zeilen(buche(abrechnung(GGF), "SKR04"))).toEqual([
      ["6024", 6000_00, 0],
      ["3720", 0, 4594_64],
      ["3730", 0, 1289_33 + 116_03],
    ]);
  });

  it("SKR04: Lohnsteuer auf 3730, nie auf SKR03 3730 Erhaltene Skonti", () => {
    expect(LOHN_KONTEN.SKR04.verbLohnsteuer).toBe("3730");
    expect(LOHN_KONTEN.SKR03.verbLohnsteuer).toBe("1741");
    expect(ACCOUNTS.SKR03.skontiErhalten).toBe("3730");
    for (const kr of ["SKR03", "SKR04"] as const) {
      expect(buche(abrechnung(GGF), kr).some((l) => l.account === ACCOUNTS[kr].skontiErhalten)).toBe(false);
    }
  });

  it("SKR03: Beschäftigter mit SV, Arbeitgeberanteile und Umlagen als gesetzliche soziale Aufwendungen", () => {
    const a = abrechnung(ANGESTELLT);
    expect(zeilen(buche(a, "SKR03"))).toEqual([
      ["4120", 4000_00, 0],
      ["4130", 937_60, 0],
      ["1740", 0, 2640_17],
      ["1741", 0, 539_83],
      ["1742", 0, 820_00 + 937_60],
    ]);
  });

  it("SKR04: Beschäftigter, auch im Einzelunternehmen", () => {
    expect(zeilen(buche(abrechnung(ANGESTELLT), "SKR04", "einzelunternehmen"))).toEqual([
      ["6020", 4000_00, 0],
      ["6110", 937_60, 0],
      ["3720", 0, 2640_17],
      ["3730", 0, 539_83],
      ["3740", 0, 820_00 + 937_60],
    ]);
  });

  it("SKR03: Minijob mit eigenen Konten, Pauschsteuer an die Minijob-Zentrale (§ 40a Abs. 6 EStG)", () => {
    const a = abrechnung(MINIJOB);
    expect(a.pauschsteuer).toBe(12_06);
    expect(zeilen(buche(a, "SKR03"))).toEqual([
      ["4195", 603_00, 0],
      ["4144", 187_95 - 12_06, 0],
      ["4194", 12_06, 0],
      ["1740", 0, 581_29],
      ["1742", 0, 21_71 + 187_95],
    ]);
  });

  it("SKR04: Minijob", () => {
    expect(zeilen(buche(abrechnung(MINIJOB), "SKR04", "einzelunternehmen"))).toEqual([
      ["6035", 603_00, 0],
      ["6171", 187_95 - 12_06, 0],
      ["6036", 12_06, 0],
      ["3720", 0, 581_29],
      ["3740", 0, 21_71 + 187_95],
    ]);
  });

  it.each(["SKR03", "SKR04"] as const)("%s: jede Buchung ist ausgeglichen und ohne Steuerschlüssel", (kr) => {
    for (const s of [GGF, MINIJOB, ANGESTELLT]) {
      const lines = buche(abrechnung(s), kr);
      expect(lines.reduce((sum, l) => sum + l.debit - l.credit, 0)).toBe(0);
      expect(lines.every((l) => l.taxCode === null)).toBe(true);
    }
  });

  it("Storno: dieselben Zeilen mit getauschten Seiten", () => {
    const lines = buche(abrechnung(ANGESTELLT), "SKR04");
    const storno = lohnStornoBuchung(lines);
    expect(zeilen(storno)).toEqual(lines.map((l) => [l.account, l.credit, l.debit]));
  });

  it("Einzelunternehmen: keinen Gesellschafter-Geschäftsführer buchen (es gibt keinen)", () => {
    const r = lohnBuchung(abrechnung(GGF), "SKR03", "einzelunternehmen");
    expect(r).toEqual({ ok: false, meldung: expect.stringMatching(/Gesellschafter-Geschäftsführer.*GmbH und UG/) });
  });

  it("Zuschuss zur privaten Krankenversicherung (Auszahlung über Netto) ist nicht unterstützt", () => {
    const a = { ...abrechnung(ANGESTELLT), auszahlung: abrechnung(ANGESTELLT).netto + 100_00 };
    expect(lohnBuchung(a, "SKR03", "gmbh")).toEqual({ ok: false, meldung: expect.stringMatching(/nicht unterstützt/) });
  });

  it("lehnt Abrechnungen ab, deren Summen nicht aufgehen", () => {
    const a = abrechnung(ANGESTELLT);
    expect(lohnBuchung({ ...a, netto: a.netto + 1 }, "SKR03", "gmbh").ok).toBe(false);
    expect(lohnBuchung({ ...a, pauschsteuer: 5_00 }, "SKR03", "gmbh").ok).toBe(false);
    expect(lohnBuchung({ ...a, lohnsteuer: -1 }, "SKR03", "gmbh").ok).toBe(false);
  });
});

describe("Lohnkonten im Kontenrahmen", () => {
  /** Alle anderen Konten, die Haben bebucht */
  function andereKonten(kr: Kontenrahmen): Set<string> {
    const flat = (value: unknown): string[] => (typeof value === "string" ? [value] : Object.values(value as object).flatMap(flat));
    return new Set([
      ...flat(ACCOUNTS[kr]),
      ...Object.values(EXPENSE_CATEGORIES).map((c) => c[kr]),
      ...flat(ASSET_ACCOUNTS[kr]),
      ...Object.values(PAUSCHALE_KONTEN).map((p) => p[kr].konto),
    ]);
  }

  it.each(["SKR03", "SKR04"] as const)("%s: keine Kollision mit anderen Konten von Haben", (kr) => {
    const andere = andereKonten(kr);
    for (const konto of Object.values(LOHN_KONTEN[kr])) expect(andere.has(konto), konto).toBe(false);
  });

  it.each(["SKR03", "SKR04"] as const)("%s: Aufwand im Personalaufwand, Verbindlichkeiten unter den Verbindlichkeiten", (kr) => {
    const k = LOHN_KONTEN[kr];
    for (const konto of [k.gehaelter, k.ggf, k.minijob, k.minijobPauschsteuer, k.sozial, k.minijobSozial]) {
      expect(postenOf(kr, konto), konto).toBe("personalaufwand");
      expect(carriesForward(kr, konto), konto).toBe(false);
    }
    for (const konto of [k.verbLohn, k.verbLohnsteuer, k.verbSv]) {
      expect(postenForSaldo(kr, konto, -100), konto).toBe("passiva.C");
      // Überzahlt (Soll-Saldo): sonstiger Vermögensgegenstand (DATEV „Sonstige Verbindlichkeiten oder Sonstige Vermögensgegenstände“)
      expect(postenForSaldo(kr, konto, 100), konto).toBe("aktiva.B");
      expect(carriesForward(kr, konto), konto).toBe(true);
    }
  });

  it.each(["SKR03", "SKR04"] as const)("%s: E-Bilanz-Positionen der Lohnkonten", (kr) => {
    const k = LOHN_KONTEN[kr];
    const staff = "is.netIncome.regular.operatingTC.staff";
    expect(ebilanzPosition(kr, k.gehaelter, 100)).toBe(`${staff}.salaries.misc`);
    expect(ebilanzPosition(kr, k.ggf, 100)).toBe(`${staff}.salaries.managerPartner`);
    expect(ebilanzPosition(kr, k.minijob, 100)).toBe(`${staff}.salaries.minijobs`);
    expect(ebilanzPosition(kr, k.minijobPauschsteuer, 100)).toBe(`${staff}.salaries.minijobs`);
    expect(ebilanzPosition(kr, k.sozial, 100)).toBe(`${staff}.social.socExp.other`);
    expect(ebilanzPosition(kr, k.minijobSozial, 100)).toBe(`${staff}.social.socExp.other`);
    expect(ebilanzPosition(kr, k.verbLohn, -100)).toBe("bs.eqLiab.liab.other.employees");
    expect(ebilanzPosition(kr, k.verbLohn, 100)).toBe("bs.ass.currAss.receiv.other.employees");
    expect(ebilanzPosition(kr, k.verbLohnsteuer, -100)).toBe("bs.eqLiab.liab.other.theroffTax.otherTaxes");
    expect(ebilanzPosition(kr, k.verbLohnsteuer, 100)).toBe("bs.ass.currAss.receiv.other.otherTaxRec");
    expect(ebilanzPosition(kr, k.verbSv, -100)).toBe("bs.eqLiab.liab.other.thereoffSocSec");
    expect(ebilanzPosition(kr, k.verbSv, 100)).toBe("bs.ass.currAss.receiv.other.socInsur");
  });
});

describe("Nebenbuch Lohn (manuelle Buchungen)", () => {
  it.each(["SKR03", "SKR04"] as const)("%s: alle Lohnkonten führt das Nebenbuch Lohn", (kr) => {
    const managed = ledgerManagedAccounts(kr);
    for (const konto of Object.values(LOHN_KONTEN[kr])) expect(managed.get(konto), konto).toBe("Lohn");
  });

  it("SKR03: manuelle Umbuchung auf 4120 abgelehnt", () => {
    const issues = manualPostingIssues(
      [
        { account: "4120", debit: 100_00, credit: 0 },
        { account: "0730", debit: 0, credit: 100_00 },
      ],
      "SKR03",
      "gmbh",
    );
    expect(issues).toContain("Zeile 1: Konto 4120 führt das Nebenbuch Lohn");
  });

  it("SKR04: in der Eröffnung sind die Lohnverbindlichkeiten aus der bisherigen Buchhaltung erlaubt, der Aufwand nicht", () => {
    const eroeffnung = (account: string) =>
      manualPostingIssues(
        [
          { account: "9000", debit: 500_00, credit: 0 },
          { account, debit: 0, credit: 500_00 },
        ],
        "SKR04",
        "gmbh",
        "eroeffnung",
      );
    for (const konto of ["3720", "3730", "3740"]) expect(eroeffnung(konto)).toEqual([]);
    expect(eroeffnung("6020")).toEqual(["Zeile 2: Konto 6020 ist ein Erfolgskonto; die Eröffnung übernimmt nur Bestände"]);
    // Umbuchung im laufenden Jahr bleibt gesperrt
    expect(
      manualPostingIssues(
        [
          { account: "3730", debit: 500_00, credit: 0 },
          { account: "3510", debit: 0, credit: 500_00 },
        ],
        "SKR04",
        "gmbh",
      ),
    ).toEqual(["Zeile 1: Konto 3730 führt das Nebenbuch Lohn"]);
  });
});

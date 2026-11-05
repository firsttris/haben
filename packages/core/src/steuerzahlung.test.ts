import { describe, expect, it } from "vitest";
import { computeEuer } from "./euer.ts";
import { directPosting } from "./posting.ts";
import {
  nichtAbziehbareNebenleistungen,
  STEUER_KONTO_NAMEN,
  steuerartenFor,
  steuerEuerWirkung,
  steuerKontierung,
  steuerzahlungPosting,
  steuerzahlungText,
  type Steuerangabe,
  type SteuerKontierung,
} from "./steuerzahlung.ts";

/*
 * Steuerzahlungen im Bankabgleich (Roadmap Platz 13, Prüffälle aus #312). Konten nach dem DATEV-Kontenrahmen 2026
 * (SKR03 Art.-Nr. 11174, SKR04 Art.-Nr. 11175).
 */

const ok = (k: SteuerKontierung) => {
  if (!k.ok) throw new Error(k.fehler);
  return k;
};
const konto = (angabe: Steuerangabe, amount: number, kr: "SKR03" | "SKR04", rf: "einzelunternehmen" | "gmbh" = "einzelunternehmen", datum = "2026-10-15") =>
  ok(steuerKontierung(angabe, amount, datum, kr, rf));
const balanced = (lines: { debit: number; credit: number }[]) => lines.reduce((s, l) => s + l.debit, 0) === lines.reduce((s, l) => s + l.credit, 0);

describe("steuerKontierung: Umsatzsteuer früherer Jahre", () => {
  it("Prüffall 1: 1.000 € für 2024 im Oktober 2026 gezahlt: frühere Jahre (SKR03 1791, SKR04 3845), ohne Steuerschlüssel", () => {
    const angabe: Steuerangabe = { art: "ust", jahr: 2024, posten: "steuer" };
    expect(konto(angabe, -1000_00, "SKR03")).toEqual({ ok: true, konto: "1791", rueckstellung: null });
    expect(konto(angabe, -1000_00, "SKR04").konto).toBe("3845");
    const lines = steuerzahlungPosting(konto(angabe, -1000_00, "SKR03"), -1000_00, 0, "SKR03");
    expect(lines).toEqual([
      { account: "1200", debit: 0, credit: 1000_00, taxCode: null },
      { account: "1791", debit: 1000_00, credit: 0, taxCode: null },
    ]);
    expect(steuerzahlungText(angabe, -1000_00)).toBe("Umsatzsteuer 2024 · Zahlung");
  });

  it("Vorjahr auf 1790 bzw. 3841, Erstattung auf dasselbe Konto", () => {
    const angabe: Steuerangabe = { art: "ust", jahr: 2025, posten: "steuer" };
    expect(konto(angabe, -500_00, "SKR03").konto).toBe("1790");
    expect(konto(angabe, 500_00, "SKR04").konto).toBe("3841");
    expect(steuerzahlungPosting(konto(angabe, 500_00, "SKR04"), 500_00, 0, "SKR04")).toEqual([
      { account: "1800", debit: 500_00, credit: 0, taxCode: null },
      { account: "3841", debit: 0, credit: 500_00, taxCode: null },
    ]);
    expect(steuerzahlungText(angabe, 500_00)).toBe("Umsatzsteuer 2025 · Erstattung");
  });

  it("Umsatzsteuer des laufenden Jahres läuft über die Voranmeldung, nicht hier", () => {
    const k = steuerKontierung({ art: "ust", jahr: 2026, posten: "steuer" }, -100_00, "2026-10-15", "SKR03", "einzelunternehmen");
    expect(k).toMatchObject({ ok: false, fehler: expect.stringMatching(/Voranmeldung/) });
  });

  it("Bezugsjahr nach der Zahlung oder vor 2000 abgelehnt", () => {
    expect(steuerKontierung({ art: "gewst", jahr: 2027, posten: "steuer" }, -1, "2026-10-15", "SKR03", "einzelunternehmen").ok).toBe(false);
    expect(steuerKontierung({ art: "gewst", jahr: 1999, posten: "steuer" }, -1, "2026-10-15", "SKR03", "einzelunternehmen").ok).toBe(false);
  });
});

describe("steuerKontierung: Gewerbesteuer (§ 4 Abs. 5b EStG)", () => {
  it("Vorauszahlung des laufenden Jahres auf 4320 bzw. 7610, Vorjahre auf 2281 bzw. 7641 (Nachzahlung und Erstattung)", () => {
    expect(konto({ art: "gewst", jahr: 2026, posten: "steuer" }, -250_00, "SKR03").konto).toBe("4320");
    expect(konto({ art: "gewst", jahr: 2026, posten: "steuer" }, -250_00, "SKR04").konto).toBe("7610");
    expect(konto({ art: "gewst", jahr: 2024, posten: "steuer" }, -500_00, "SKR03").konto).toBe("2281");
    expect(konto({ art: "gewst", jahr: 2024, posten: "steuer" }, 500_00, "SKR04").konto).toBe("7641");
  });

  it("Nebenleistungen zur Gewerbesteuer sind nicht abziehbar", () => {
    const n = (posten: Steuerangabe["posten"], kr: "SKR03" | "SKR04") => konto({ art: "gewst", jahr: 2024, posten }, -10_00, kr).konto;
    expect([n("zinsen233a", "SKR03"), n("zinsen", "SKR03"), n("saeumnis", "SKR03"), n("verspaetung", "SKR03")]).toEqual(["2105", "2108", "2102", "4397"]);
    expect([n("zinsen233a", "SKR04"), n("zinsen", "SKR04"), n("saeumnis", "SKR04"), n("verspaetung", "SKR04")]).toEqual(["7308", "7306", "7302", "6437"]);
  });

  it("Erstattungszinsen zur Gewerbesteuer bucht Haben nicht", () => {
    const k = steuerKontierung({ art: "gewst", jahr: 2024, posten: "zinsen233a" }, 12_00, "2026-10-15", "SKR03", "einzelunternehmen");
    expect(k).toMatchObject({ ok: false, fehler: expect.stringMatching(/Erstattungszinsen zur Gewerbesteuer/) });
  });

  it("GmbH: Nachzahlung für ein Vorjahr verbraucht zuerst die Gewerbesteuerrückstellung (0956 bzw. 3035)", () => {
    const k = konto({ art: "gewst", jahr: 2025, posten: "steuer" }, -500_00, "SKR03", "gmbh");
    expect(k).toEqual({ ok: true, konto: "2281", rueckstellung: "0956" });
    const lines = steuerzahlungPosting(k, -500_00, 300_00, "SKR03");
    expect(lines).toEqual([
      { account: "1200", debit: 0, credit: 500_00, taxCode: null },
      { account: "0956", debit: 300_00, credit: 0, taxCode: null },
      { account: "2281", debit: 200_00, credit: 0, taxCode: null },
    ]);
    expect(balanced(lines)).toBe(true);
    expect(konto({ art: "gewst", jahr: 2025, posten: "steuer" }, -500_00, "SKR04", "gmbh").rueckstellung).toBe("3035");
    // Ganz aus der Rückstellung: keine Zeile auf dem Vorjahreskonto
    expect(steuerzahlungPosting(k, -500_00, 500_00, "SKR03").map((l) => l.account)).toEqual(["1200", "0956"]);
    // Mehr als die Zahlung ist kein Verbrauch
    expect(() => steuerzahlungPosting(k, -500_00, 600_00, "SKR03")).toThrow(RangeError);
  });

  it("Einzelunternehmen hat keine Rückstellung, Erstattungen nie", () => {
    expect(konto({ art: "gewst", jahr: 2025, posten: "steuer" }, -500_00, "SKR03").rueckstellung).toBeNull();
    expect(konto({ art: "gewst", jahr: 2025, posten: "steuer" }, 500_00, "SKR03", "gmbh").rueckstellung).toBeNull();
    expect(() => steuerzahlungPosting({ konto: "2281", rueckstellung: null }, -500_00, 1, "SKR03")).toThrow(RangeError);
  });
});

describe("steuerKontierung: Steuern vom Einkommen", () => {
  it("Einzelunternehmen: Einkommen-, Kirchensteuer und Soli samt Nebenleistungen privat (SKR03 1810, SKR04 2150)", () => {
    for (const art of ["est", "kist", "soli"] as const) {
      for (const posten of ["steuer", "zinsen233a", "zinsen", "saeumnis", "verspaetung"] as const) {
        expect(konto({ art, jahr: 2024, posten }, -100_00, "SKR03").konto).toBe("1810");
        expect(konto({ art, jahr: 2024, posten }, -100_00, "SKR04").konto).toBe("2150");
      }
    }
    // Erstattung der Steuer ebenfalls auf Privatsteuern; Erstattungszinsen sind private Kapitalerträge, also Einlage
    expect(konto({ art: "est", jahr: 2024, posten: "steuer" }, 800_00, "SKR03").konto).toBe("1810");
    expect(konto({ art: "est", jahr: 2024, posten: "zinsen233a" }, 15_00, "SKR03").konto).toBe("1890");
    expect(konto({ art: "est", jahr: 2024, posten: "zinsen233a" }, 15_00, "SKR04").konto).toBe("2180");
    expect(konto({ art: "est", jahr: 2026, posten: "steuer" }, -1500_00, "SKR03").konto).toBe("1810");
  });

  it("GmbH: Körperschaftsteuer und Soli des Jahres als Vorauszahlung, für Vorjahre Nachzahlung bzw. Erstattung", () => {
    const g = (art: "kst" | "soli", jahr: number, amount: number, kr: "SKR03" | "SKR04") => konto({ art, jahr, posten: "steuer" }, amount, kr, "gmbh");
    expect([g("kst", 2026, -1, "SKR03").konto, g("soli", 2026, -1, "SKR03").konto]).toEqual(["2200", "2208"]);
    expect([g("kst", 2026, -1, "SKR04").konto, g("soli", 2026, -1, "SKR04").konto]).toEqual(["7600", "7608"]);
    expect(g("kst", 2025, -1, "SKR03")).toEqual({ ok: true, konto: "2203", rueckstellung: "0963" });
    expect(g("soli", 2025, -1, "SKR04")).toEqual({ ok: true, konto: "7609", rueckstellung: "3040" });
    expect([g("kst", 2025, 1, "SKR03").konto, g("soli", 2025, 1, "SKR03").konto]).toEqual(["2204", "2210"]);
    expect([g("kst", 2025, 1, "SKR04").konto, g("soli", 2025, 1, "SKR04").konto]).toEqual(["7604", "7607"]);
    // Nebenleistungen nicht abziehbar (§ 10 Nr. 2 KStG)
    expect(konto({ art: "kst", jahr: 2024, posten: "saeumnis" }, -5_00, "SKR03", "gmbh").konto).toBe("2104");
    expect(konto({ art: "kst", jahr: 2024, posten: "zinsen233a" }, -5_00, "SKR04", "gmbh").konto).toBe("7308");
  });

  it("Steuerarten je Rechtsform", () => {
    expect(steuerartenFor("einzelunternehmen")).toEqual(["ust", "gewst", "est", "kist", "soli", "kapest", "kapestSoli"]);
    expect(steuerartenFor("gmbh")).toEqual(["ust", "gewst", "soli", "kst", "kapest", "kapestSoli"]);
    expect(steuerKontierung({ art: "est", jahr: 2024, posten: "steuer" }, -1, "2026-10-15", "SKR03", "ug")).toMatchObject({
      ok: false,
      fehler: "Einkommensteuer gibt es nur im Einzelunternehmen.",
    });
    expect(steuerKontierung({ art: "kst", jahr: 2024, posten: "steuer" }, -1, "2026-10-15", "SKR03", "einzelunternehmen")).toMatchObject({
      ok: false,
      fehler: "Körperschaftsteuer gibt es nur in GmbH und UG.",
    });
  });
});

describe("steuerKontierung: Nebenleistungen zur Umsatzsteuer (Steuerart entscheidet, nicht das Wort „Zinsen“)", () => {
  it("abziehbar: § 233a AO 2107/7305, §§ 234–237 AO 2111/7311, Säumniszuschlag 2103/7303, Verspätungszuschlag 4396/6436", () => {
    const n = (posten: Steuerangabe["posten"], kr: "SKR03" | "SKR04") => konto({ art: "ust", jahr: 2026, posten }, -10_00, kr).konto;
    expect([n("zinsen233a", "SKR03"), n("zinsen", "SKR03"), n("saeumnis", "SKR03"), n("verspaetung", "SKR03")]).toEqual(["2107", "2111", "2103", "4396"]);
    expect([n("zinsen233a", "SKR04"), n("zinsen", "SKR04"), n("saeumnis", "SKR04"), n("verspaetung", "SKR04")]).toEqual(["7305", "7311", "7303", "6436"]);
  });

  it("Erstattungszinsen zur Umsatzsteuer sind steuerpflichtige Zinserträge (2657 bzw. 7105)", () => {
    expect(konto({ art: "ust", jahr: 2024, posten: "zinsen233a" }, 30_00, "SKR03").konto).toBe("2657");
    expect(konto({ art: "ust", jahr: 2024, posten: "zinsen233a" }, 30_00, "SKR04", "gmbh").konto).toBe("7105");
  });

  it("Zinsen zur Einkommensteuer sind dagegen privat", () => {
    expect(konto({ art: "est", jahr: 2024, posten: "zinsen233a" }, -10_00, "SKR03").konto).toBe("1810");
  });
});

describe("Kapitalertragsteuer auf betriebliche Zinsen", () => {
  it("Zinsgutschrift aufgeteilt: Bruttozins als Zinsertrag, einbehaltene Steuer als Entnahme bzw. Steueraufwand der GmbH", () => {
    expect(directPosting("zinsertrag", 100_00, "SKR03", "einzelunternehmen")).toEqual([
      { account: "1200", debit: 100_00, credit: 0, taxCode: null },
      { account: "2650", debit: 0, credit: 100_00, taxCode: null },
    ]);
    expect(directPosting("zinsertrag", 100_00, "SKR04", "gmbh")[1]!.account).toBe("7100");
    expect(konto({ art: "kapest", jahr: 2026, posten: "steuer" }, -25_00, "SKR03").konto).toBe("1810");
    expect(konto({ art: "kapestSoli", jahr: 2026, posten: "steuer" }, -1_37, "SKR04").konto).toBe("2150");
    expect(konto({ art: "kapest", jahr: 2026, posten: "steuer" }, -25_00, "SKR03", "gmbh").konto).toBe("2213");
    expect(konto({ art: "kapestSoli", jahr: 2026, posten: "steuer" }, -1_37, "SKR04", "gmbh").konto).toBe("7633");
    expect(steuerKontierung({ art: "kapest", jahr: 2026, posten: "steuer" }, 25_00, "2026-10-15", "SKR03", "gmbh").ok).toBe(false);
    expect(steuerKontierung({ art: "kapest", jahr: 2026, posten: "zinsen" }, -1, "2026-10-15", "SKR03", "gmbh").ok).toBe(false);
  });
});

describe("Prüffall 3: Steuerbescheid mit Hauptsteuer, Zinsen und Zuschlag in einer Zahlung", () => {
  const teile: [Steuerangabe, number][] = [
    [{ art: "gewst", jahr: 2024, posten: "steuer" }, -500_00],
    [{ art: "gewst", jahr: 2024, posten: "zinsen233a" }, -18_00],
    [{ art: "gewst", jahr: 2024, posten: "verspaetung" }, -25_00],
  ];

  it("jeder Teil auf sein Konto, zusammen die ganze Zahlung", () => {
    const lines = teile.flatMap(([angabe, amount]) => steuerzahlungPosting(konto(angabe, amount, "SKR03"), amount, 0, "SKR03"));
    expect(balanced(lines)).toBe(true);
    expect(lines.filter((l) => l.debit > 0).map((l) => [l.account, l.debit])).toEqual([
      ["2281", 500_00],
      ["2105", 18_00],
      ["4397", 25_00],
    ]);
    expect(lines.filter((l) => l.account === "1200").reduce((s, l) => s + l.credit, 0)).toBe(543_00);
  });

  it("EÜR: 500 € Gewerbesteuer sind keine Betriebsausgabe wie 500 € Betriebsbedarf, sondern nur nachrichtlich", () => {
    const euer = computeEuer(
      2026,
      teile.map(([angabe, amount], i) => ({ kind: "steuer" as const, date: "2026-10-15", amount, art: angabe.art, posten: angabe.posten, group: `t|${i}` })),
    );
    expect(euer.totalAusgaben).toBe(0);
    expect(euer.gewinn).toBe(0);
    expect(euer.gewerbesteuerNichtAbziehbar).toBe(543_00);
  });

  it("dieselben Teile zur Umsatzsteuer: Steuer als gezahlte Umsatzsteuer, Zinsen und Zuschlag abziehbar", () => {
    const euer = computeEuer(2026, [
      { kind: "steuer", date: "2026-10-15", amount: -500_00, art: "ust", posten: "steuer" },
      { kind: "steuer", date: "2026-10-15", amount: -18_00, art: "ust", posten: "zinsen233a" },
      { kind: "steuer", date: "2026-10-15", amount: -25_00, art: "ust", posten: "verspaetung" },
    ]);
    expect(euer.ausgaben.find((l) => l.key === "gezahlteUst")?.amount).toBe(500_00);
    expect(euer.ausgaben.find((l) => l.key === "steuerNebenleistungen")?.amount).toBe(43_00);
    expect(euer.gewinn).toBe(-543_00);
    expect(euer.gewerbesteuerNichtAbziehbar).toBe(0);
  });
});

describe("EÜR nach Zahlung", () => {
  it("Prüffall 1: Umsatzsteuer 2024, gezahlt im Oktober 2026, zählt 2026 als gezahlte Umsatzsteuer, nicht 2024", () => {
    const zahlung = { kind: "steuer" as const, date: "2026-10-15", amount: -1000_00, art: "ust" as const, posten: "steuer" as const };
    expect(computeEuer(2026, [zahlung]).ausgaben.find((l) => l.key === "gezahlteUst")?.amount).toBe(1000_00);
    expect(computeEuer(2024, [zahlung]).totalAusgaben).toBe(0);
    // Kein neuer Umsatz, keine Vorsteuer
    const euer = computeEuer(2026, [zahlung]);
    expect(euer.einnahmen.find((l) => l.key === "vereinnahmteUst")?.amount).toBe(0);
    expect(euer.ausgaben.find((l) => l.key === "vorsteuer")?.amount).toBe(0);
    expect(euer.monthly.ausgaben.every((m) => m === 0)).toBe(true);
  });

  it("Erstattung früherer Jahre, Erstattungszinsen, Zinserträge; private Steuern zählen hier nicht", () => {
    const euer = computeEuer(2026, [
      { kind: "steuer", date: "2026-03-01", amount: 300_00, art: "ust", posten: "steuer" },
      { kind: "steuer", date: "2026-03-01", amount: 12_00, art: "ust", posten: "zinsen233a" },
      { kind: "steuer", date: "2026-03-01", amount: -2000_00, art: "est", posten: "steuer" },
      { kind: "zinsertrag", date: "2026-06-30", amount: 40_00 },
    ]);
    expect(euer.einnahmen.find((l) => l.key === "erstatteteUst")?.amount).toBe(300_00);
    expect(euer.einnahmen.find((l) => l.key === "einnahmenSteuerfrei")?.amount).toBe(52_00);
    expect(euer.totalAusgaben).toBe(0);
    expect(euer.gewinn).toBe(352_00);
  });

  it("Aufgehobene Zuordnung (Gegenzeile in derselben Gruppe) hebt sich auf; verschiedene Teile verrechnen sich nicht", () => {
    const euer = computeEuer(2026, [
      { kind: "steuer", date: "2026-03-01", amount: -50_00, art: "ust", posten: "saeumnis", group: "t1" },
      { kind: "steuer", date: "2026-03-01", amount: 50_00, art: "ust", posten: "saeumnis", group: "t1" },
      { kind: "steuer", date: "2026-03-01", amount: -70_00, art: "ust", posten: "steuer", group: "t1" },
    ]);
    expect(euer.ausgaben.find((l) => l.key === "steuerNebenleistungen")).toBeUndefined();
    expect(euer.ausgaben.find((l) => l.key === "gezahlteUst")?.amount).toBe(70_00);
  });

  it("Wirkung je Steuerart", () => {
    expect(steuerEuerWirkung("ust", "steuer", -1)).toBe("umsatzsteuer");
    expect(steuerEuerWirkung("ust", "zinsen233a", 1)).toBe("einnahme");
    expect(steuerEuerWirkung("ust", "zinsen233a", -1)).toBe("nebenleistung");
    expect(steuerEuerWirkung("gewst", "saeumnis", -1)).toBe("gewerbesteuer");
    expect(steuerEuerWirkung("kist", "steuer", -1)).toBe("privat");
    expect(steuerEuerWirkung("kapest", "steuer", -1)).toBe("privat");
  });
});

describe("Kontennamen und nicht abziehbare Konten", () => {
  it("jedes Konto der Kontierung hat einen Namen", () => {
    for (const kr of ["SKR03", "SKR04"] as const) {
      for (const k of nichtAbziehbareNebenleistungen(kr)) expect(STEUER_KONTO_NAMEN[kr][k]).toBeTruthy();
    }
    expect(nichtAbziehbareNebenleistungen("SKR03")).toEqual(["2105", "2108", "2104", "2102", "4397"]);
    expect(nichtAbziehbareNebenleistungen("SKR04")).toEqual(["7308", "7306", "7304", "7302", "6437"]);
  });
});

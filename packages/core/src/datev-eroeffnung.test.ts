import { describe, expect, it } from "vitest";
import { DATEV_OPENING_MAX_LINES, datevOpeningIssues, datevOpeningLines, schlussbilanzIssues } from "./datev-eroeffnung.ts";
import { abschluss } from "./hgb.ts";
import { ACCOUNTS, openingDocumentPosting, openingInvoicePosting } from "./posting.ts";
import type { InvoiceTotals } from "./invoice.ts";

const K = {
  SKR03: { kapital: "0800", gewinnvortrag: "0860", aufwand: "4930", erloes: "8400", privat: "1800" },
  SKR04: { kapital: "2900", gewinnvortrag: "2970", aufwand: "6815", erloes: "4400", privat: "2100" },
} as const;

describe.each(["SKR03", "SKR04"] as const)("Eröffnung aus dem DATEV-Stapel, %s", (kr) => {
  const a = ACCOUNTS[kr];
  const k = K[kr];
  // Schlussbilanz: Bank, Kasse, Forderung, Vorsteuer, Vorauszahlungen gegen Stammkapital, Verbindlichkeit, Umsatzsteuer
  // und das Ergebnis aus Erlös und Aufwand
  const schluss = [
    { account: a.bank, saldo: 2_400_000 },
    { account: a.kasse, saldo: 30_000 },
    { account: a.forderungen, saldo: 119_000 },
    { account: a.vorsteuer[1900], saldo: 19_000 },
    { account: a.ustVorauszahlung, saldo: 150_000 },
    { account: k.kapital, saldo: -2_500_000 },
    { account: a.verbindlichkeiten, saldo: -11_900 },
    { account: a.ust[1900], saldo: -190_000 },
    { account: k.erloes, saldo: -1_000_000 },
    { account: k.aufwand, saldo: 983_900 },
  ];

  it("übernimmt alle Bestandskonten, das Ergebnis als Gewinnvortrag, ohne 9000", () => {
    const lines = datevOpeningLines(kr, schluss, []);
    expect(lines).toEqual(
      expect.arrayContaining([
        { account: a.bank, debit: 2_400_000, credit: 0 },
        { account: a.kasse, debit: 30_000, credit: 0 },
        { account: a.forderungen, debit: 119_000, credit: 0 },
        { account: a.ust[1900], debit: 0, credit: 190_000 },
        { account: a.ustVorauszahlung, debit: 150_000, credit: 0 },
        { account: a.verbindlichkeiten, debit: 0, credit: 11_900 },
        { account: k.gewinnvortrag, debit: 0, credit: 16_100 },
      ]),
    );
    expect(lines.map((l) => l.account)).not.toContain(k.erloes);
    expect(lines.map((l) => l.account)).not.toContain(a.saldenvortrag);
    expect(datevOpeningIssues(lines, kr, "gmbh")).toEqual([]);
    expect(datevOpeningIssues(lines, kr, "ug")).toEqual([]);
  });

  it.each(["soll", "ist"] as const)("rechnet schon übernommene offene Posten heraus (%s), 9000 ist danach ausgeglichen", (versteuerung) => {
    const totals: InvoiceTotals = { net: 100_000, tax: 19_000, gross: 119_000, taxes: [{ rate: 1900, base: 100_000, tax: 19_000 }] } as InvoiceTotals;
    const takeovers = [...openingInvoicePosting(totals, kr, versteuerung), ...openingDocumentPosting(11_900, kr)];
    const gebucht = new Map<string, number>();
    for (const l of takeovers) gebucht.set(l.account, (gebucht.get(l.account) ?? 0) + l.debit - l.credit);
    const lines = datevOpeningLines(
      kr,
      schluss,
      [...gebucht].map(([account, saldo]) => ({ account, saldo })),
    );
    // Forderung und Verbindlichkeit stecken ganz in den Übernahmen
    expect(lines.map((l) => l.account)).not.toContain(a.forderungen);
    expect(lines.map((l) => l.account)).not.toContain(a.verbindlichkeiten);
    // Nach Übernahme und Eröffnung: jedes Konto wie in der Schlussbilanz, 9000 bei null
    const nachher = new Map(gebucht);
    for (const l of lines) nachher.set(l.account, (nachher.get(l.account) ?? 0) + l.debit - l.credit);
    expect(nachher.get(a.saldenvortrag)).toBe(0);
    expect(nachher.get(a.forderungen)).toBe(119_000);
    expect(nachher.get(a.verbindlichkeiten)).toBe(-11_900);
    if (versteuerung === "ist") {
      // Bei Ist bucht die Übernahme die Steuer auf „nicht fällig“; der Stapel kennt sie dort nicht, die Eröffnung gleicht aus
      expect(nachher.get(a.ustNichtFaellig[1900])).toBe(0);
    }
    expect(datevOpeningIssues(lines, kr, "gmbh")).toEqual([]);
  });

  it("lehnt Erfolgs-, Klasse-9- und Privatkonten ab und verlangt Ausgleich", () => {
    const line = (account: string, debit: number, credit: number) => ({ account, debit, credit });
    expect(datevOpeningIssues([line(k.aufwand, 100, 0), line(a.bank, 0, 100)], kr, "gmbh")).toContain(
      `Konto ${k.aufwand} ist ein Erfolgskonto; die Eröffnung übernimmt nur Bestände`,
    );
    expect(datevOpeningIssues([line("9008", 100, 0), line(a.bank, 0, 100)], kr, "gmbh")).toContain("Konto 9008 ist ein Vortrags- oder statistisches Konto");
    expect(datevOpeningIssues([line(k.privat, 100, 0), line(a.bank, 0, 100)], kr, "gmbh")).toContain(
      `Konto ${k.privat} ist ein Privatkonto; eine GmbH oder UG bucht auf das Gesellschafter-Verrechnungskonto`,
    );
    expect(datevOpeningIssues([line(a.bank, 100, 0), line(k.kapital, 0, 90)], kr, "gmbh")).toContain("Soll und Haben sind nicht gleich");
    expect(datevOpeningIssues([line(a.bank, 100, 0), line(k.kapital, 0, 100)], kr, "einzelunternehmen")).toEqual([
      "Die Eröffnung aus dem DATEV-Stapel gibt es nur für GmbH und UG",
    ]);
    expect(datevOpeningIssues([], kr, "gmbh")).toContain("Die Schlussbilanz hat keine Bestände, die zu eröffnen wären");
  });

  it(`erlaubt mehr als 20 Zeilen, höchstens ${DATEV_OPENING_MAX_LINES}`, () => {
    const viele = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ account: String(i === 0 ? k.kapital : 1 + i).padStart(4, "0"), saldo: i === 0 ? -(n - 1) : 1 }));
    // Konten 0002 ff. sind im Anlagevermögen beider Rahmen: Bestandskonten
    expect(datevOpeningIssues(datevOpeningLines(kr, viele(40), []), kr, "gmbh")).toEqual([]);
    expect(datevOpeningIssues(datevOpeningLines(kr, viele(DATEV_OPENING_MAX_LINES + 1), []), kr, "gmbh")).toContain(
      `Höchstens ${DATEV_OPENING_MAX_LINES} Zeilen`,
    );
  });

  it("Vorbedingung: Schlussbilanz geht auf, keine offenen Vortrags- oder unbekannten Konten", () => {
    expect(schlussbilanzIssues(abschluss(kr, schluss))).toEqual([]);
    // Offene Posten über 9008/9009 vorgetragen, Sachkonten über 9000: zusammen ausgeglichen, einzeln nicht
    const opos = [
      ...schluss,
      { account: "9000", saldo: 107_100 },
      { account: "9008", saldo: -119_000 },
      { account: "9009", saldo: 11_900 },
    ];
    expect(abschlussIssuesFor(opos)).toEqual([]);
    expect(datevOpeningLines(kr, opos, [])).toEqual(datevOpeningLines(kr, schluss, []));
    const offen = abschlussIssuesFor([...schluss, { account: "9000", saldo: 500 }, { account: a.bank, saldo: -500 }]);
    expect(offen[0]).toMatch(/^Die Saldenvortragskonten 9000 bis 9009 sind zusammen nicht ausgeglichen \(5,00\s€\)$/);
    expect(offen[1]).toMatch(/^Die Schlussbilanz geht nicht auf: Aktiva/);
  });

  const abschlussIssuesFor = (salden: { account: string; saldo: number }[]) => schlussbilanzIssues(abschluss(kr, salden));
});

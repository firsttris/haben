import { describe, expect, it } from "vitest";
import { ledgerManagedAccounts, manualPosting, manualPostingIssues, reverseManualPosting } from "./manual.ts";

const line = (account: string, debit: number, credit: number) => ({ account, debit, credit });

describe("manuelle Buchung", () => {
  it.each([
    ["SKR03", "0730", "0800"],
    ["SKR04", "3510", "2900"],
  ] as const)("%s: Gesellschafter an Gezeichnetes Kapital ist buchbar", (kr, gesellschafter, kapital) => {
    const lines = [line(gesellschafter, 2_500_000, 0), line(kapital, 0, 2_500_000)];
    expect(manualPostingIssues(lines, kr, "gmbh")).toEqual([]);
    expect(manualPosting(lines)).toEqual([
      { account: gesellschafter, debit: 2_500_000, credit: 0, taxCode: null },
      { account: kapital, debit: 0, credit: 2_500_000, taxCode: null },
    ]);
  });

  it("mehrere Zeilen auf einer Seite", () => {
    expect(manualPostingIssues([line("4900", 300, 0), line("4930", 200, 0), line("0730", 0, 500)], "SKR03", "gmbh")).toEqual([]);
  });

  it("verlangt Ausgleich, beide Seiten und je Zeile genau einen Betrag", () => {
    expect(manualPostingIssues([line("4900", 300, 0), line("0730", 0, 200)], "SKR03", "gmbh")).toContain("Soll und Haben sind nicht gleich");
    expect(manualPostingIssues([line("4900", 300, 0)], "SKR03", "gmbh")).toContain("Mindestens zwei Zeilen, eine im Soll und eine im Haben");
    expect(manualPostingIssues([line("4900", 0, 0), line("0730", 0, 0)], "SKR03", "gmbh")).toContain("Zeile 1: Betrag entweder im Soll oder im Haben");
    expect(manualPostingIssues([line("4900", 100, 100), line("0730", 0, 0)], "SKR03", "gmbh")).toContain("Zeile 1: Betrag entweder im Soll oder im Haben");
    expect(manualPostingIssues([line("4900", -100, 0), line("0730", -100, 0)], "SKR03", "gmbh")).toContain("Zeile 1: Betrag ungültig");
    expect(manualPostingIssues([line("4900", 1.5, 0), line("0730", 0, 1.5)], "SKR03", "gmbh")).toContain("Zeile 1: Betrag ungültig");
    expect(manualPostingIssues([line("4900", 100, 0), line("4900", 0, 100)], "SKR03", "gmbh")).toContain("Soll und Haben auf demselben Konto ändern nichts");
    expect(manualPostingIssues([line("490", 100, 0), line("0730", 0, 100)], "SKR03", "gmbh")).toContain("Zeile 1: Konto hat vier Ziffern");
    expect(
      manualPostingIssues(
        Array.from({ length: 21 }, (_, i) => line("4900", i === 0 ? 0 : 1, i === 0 ? 20 : 0)),
        "SKR03",
        "gmbh",
      ),
    ).toContain("Höchstens 20 Zeilen");
  });

  it.each([
    ["SKR03", "1200", "Bank"],
    ["SKR03", "1000", "Kassenbuch"],
    ["SKR03", "1361", "Bank (Zahlungsdienstleister)"],
    ["SKR03", "1360", "Bank (Geldtransit)"],
    ["SKR03", "1400", "Rechnungen (offene Posten)"],
    ["SKR03", "1600", "Belege (offene Posten)"],
    ["SKR03", "1776", "Umsatzsteuer"],
    ["SKR03", "1576", "Umsatzsteuer"],
    ["SKR03", "1780", "Umsatzsteuer"],
    ["SKR03", "8400", "Rechnungen (Erlöse)"],
    ["SKR03", "0320", "Anlagen"],
    ["SKR03", "4830", "Anlagen"],
    ["SKR04", "1800", "Bank"],
    ["SKR04", "1600", "Kassenbuch"],
    ["SKR04", "1200", "Rechnungen (offene Posten)"],
    ["SKR04", "3300", "Belege (offene Posten)"],
    ["SKR04", "3806", "Umsatzsteuer"],
    ["SKR04", "1406", "Umsatzsteuer"],
    ["SKR04", "4400", "Rechnungen (Erlöse)"],
    ["SKR04", "6220", "Anlagen"],
    // Entstandene Einfuhrumsatzsteuer: Kz 62 der Voranmeldung kommt aus den Belegen, eine Umbuchung daran vorbei bräche den Abgleich
    ["SKR03", "1588", "Umsatzsteuer"],
    ["SKR04", "1433", "Umsatzsteuer"],
  ] as const)("%s: Konto %s führt das Nebenbuch %s", (kr, account, ledger) => {
    expect(ledgerManagedAccounts(kr).get(account)).toBe(ledger);
    expect(manualPostingIssues([line(account, 100, 0), line("4900", 0, 100)], kr, "gmbh")).toContain(`Zeile 1: Konto ${account} führt das Nebenbuch ${ledger}`);
  });

  it("lehnt Vortrags- und statistische Konten der Klasse 9 ab", () => {
    expect(manualPostingIssues([line("9000", 100, 0), line("0730", 0, 100)], "SKR04", "gmbh")).toContain(
      "Zeile 1: Konto 9000 ist ein Vortrags- oder statistisches Konto",
    );
  });

  it.each([
    ["SKR03", "1800", "1890"],
    ["SKR04", "2100", "2180"],
  ] as const)("%s: Privatkonten nur im Einzelunternehmen", (kr, entnahme, einlage) => {
    expect(manualPostingIssues([line(entnahme, 100, 0), line(einlage, 0, 100)], kr, "einzelunternehmen")).toEqual([]);
    expect(manualPostingIssues([line(entnahme, 100, 0), line(einlage, 0, 100)], kr, "gmbh")).toEqual([
      `Zeile 1: Konto ${entnahme} ist ein Privatkonto; eine GmbH oder UG bucht auf das Gesellschafter-Verrechnungskonto`,
      `Zeile 2: Konto ${einlage} ist ein Privatkonto; eine GmbH oder UG bucht auf das Gesellschafter-Verrechnungskonto`,
    ]);
  });

  it("Gegenbuchung tauscht die Seiten", () => {
    expect(reverseManualPosting([{ account: "4900", debit: 300, credit: 0, taxCode: null }])).toEqual([
      { account: "4900", debit: 0, credit: 300, taxCode: null },
    ]);
  });
});

describe("Eröffnungsbuchung", () => {
  it.each([
    ["SKR03", "1200", "0800", "0730", "4900", "1400", "1776"],
    ["SKR04", "1800", "2900", "3510", "6300", "1200", "3806"],
  ] as const)(
    "%s: Bestände gegen 9000, auch die Bank; keine Erfolgskonten, offenen Posten oder Steuern",
    (kr, bank, kapital, gesellschafter, aufwand, forderungen, ust) => {
      const ok = [line(bank, 3_000_000, 0), line(gesellschafter, 0, 500_000), line(kapital, 0, 2_500_000)];
      expect(manualPostingIssues(ok, kr, "gmbh", "eroeffnung")).toEqual([]);
      expect(manualPostingIssues([line(bank, 100, 0), line("9000", 0, 100)], kr, "gmbh", "eroeffnung")).toEqual([]);
      // Dieselbe Buchung als Umbuchung: Bank und 9000 sind gesperrt
      expect(manualPostingIssues([line(bank, 100, 0), line("9000", 0, 100)], kr, "gmbh")).toHaveLength(2);
      expect(manualPostingIssues([line(aufwand, 100, 0), line("9000", 0, 100)], kr, "gmbh", "eroeffnung")).toEqual([
        `Zeile 1: Konto ${aufwand} ist ein Erfolgskonto; die Eröffnung übernimmt nur Bestände`,
      ]);
      expect(manualPostingIssues([line(forderungen, 100, 0), line("9000", 0, 100)], kr, "gmbh", "eroeffnung")[0]).toContain("Nebenbuch Rechnungen");
      expect(manualPostingIssues([line("9000", 100, 0), line(ust, 0, 100)], kr, "gmbh", "eroeffnung")[0]).toContain("Nebenbuch Umsatzsteuer");
    },
  );
});

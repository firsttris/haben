import { describe, expect, it } from "vitest";
import { ebilanzPosition } from "./ebilanz.ts";
import { euerAusZeilen, euerZuordnung } from "./journal-euer.ts";
import { kontoImKontenrahmen } from "./kontenrahmen-wechsel.ts";
import { ledgerManagedAccounts } from "./manual.ts";
import { reservedAccountNumbers } from "./own-accounts.ts";
import { ACCOUNT_NAMES, invoicePosting } from "./posting.ts";

// DATEV SKR03/04 2026: 8192/4184 sind die §-19-Standardkonten; 8195/4185 bleiben Haben-Bestandskonten.
// https://www.datev.de/content/dam/markenassets/themen-und-produktgruppen/zielgruppen/mandant/unternehmer/branche/bau/11174%20SKR03%20BilrUg.pdf
// https://www.datev.de/content/dam/markenassets/themen-und-produktgruppen/zielgruppen/mandant/unternehmer/branche/bau/11175%20SKR04%20BilrUg.pdf
describe.each([
  ["SKR03", "ist", "8192", "8195", "SKR04", "4184"],
  ["SKR04", "soll", "4184", "4185", "SKR03", "8192"],
] as const)("Kleinunternehmer-Standardkonto mit Bestand (%s/%s)", (kr, mode, current, legacy, other, otherCurrent) => {
  it("bucht neue Rechnungen mit dem DATEV-Standardkonto und weiterhin ohne Umsatzsteuer", () => {
    const totals = { net: 25_000, tax: 0, gross: 25_000, taxes: [{ rate: 0, base: 25_000, tax: 0 }] };
    const lines = invoicePosting(totals, kr, mode, "kleinunternehmer");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toEqual({ account: current, debit: 0, credit: 25_000, taxCode: "KU" });
  });

  it("erhält die EÜR-Zuordnung alter und neuer Konten und summiert ein gemischtes Jahr unverändert", () => {
    for (const account of [legacy, current]) expect(euerZuordnung(kr, account, "sonst")).toBe("einnahmenKleinunternehmer");
    const stored = [
      { account: legacy, debit: 0, credit: 30_000, taxCode: "KU" },
      { account: current, debit: 0, credit: 50_000, taxCode: "KU" },
    ];
    const before = structuredClone(stored);
    expect(euerAusZeilen(kr, stored).zeilen).toEqual({ einnahmenKleinunternehmer: 80_000 });
    expect(stored).toEqual(before);
  });

  it("behält die besondere §-19-E-Bilanzposition auch für das frühere Konto", () => {
    for (const account of [legacy, current]) expect(ebilanzPosition(kr, account, -1)).toMatch(/\.taxExemptUStG19_1$/);
  });

  it("benennt und reserviert beide Konten und hält sie unter der Verwaltung der Erlösbuchungen", () => {
    for (const account of [legacy, current]) {
      expect(ACCOUNT_NAMES[kr][account]).toContain("Kleinunternehmer");
      expect(reservedAccountNumbers(kr).has(account)).toBe(true);
      expect(ledgerManagedAccounts(kr).get(account)).toBe("Rechnungen (Erlöse)");
    }
  });

  it("lässt alte Gegenbuchungen im selben Rahmen auf ihrem Konto und überträgt sie sonst auf das heutige Gegenkonto", () => {
    expect(kontoImKontenrahmen(kr, kr, legacy)).toBe(legacy);
    expect(kontoImKontenrahmen(kr, other, legacy)).toBe(otherCurrent);
    expect(kontoImKontenrahmen(kr, other, current)).toBe(otherCurrent);
  });
});

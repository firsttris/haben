import { describe, expect, it } from "vitest";
import { externalSettlementProblem, isExternalSettlementPayment, type ExternalSettlementJournal } from "./external-settlements.ts";
import {
  ACCOUNTS,
  documentPaymentPosting,
  documentPosting,
  invoicePaymentPosting,
  invoicePosting,
  paymentProviderAccount,
  type Kontenrahmen,
} from "./posting.ts";
import { totalsFromTaxes } from "./invoice.ts";

const totals = totalsFromTaxes([{ rate: 1900, base: 100000, tax: 19000 }]);
const original = (kr: Kontenrahmen): ExternalSettlementJournal => ({ externalId: "AR", date: "2026-01-15", lines: invoicePosting(totals, kr, "ist") });
const payment = (kr: Kontenrahmen, amount = 119000, settles = "AR"): ExternalSettlementJournal => ({
  externalId: "zahlung",
  date: "2026-02-15",
  lines: invoicePaymentPosting(totals, amount, kr, "ist"),
  settles,
});

for (const kr of ["SKR03", "SKR04"] as const)
  describe(`Importierte Zahlungsbezüge ohne Datenbank (${kr})`, () => {
    it.each([ACCOUNTS[kr].kasse, ACCOUNTS[kr].geldtransit, ACCOUNTS[kr].gesellschafter, kr === "SKR03" ? "1890" : "2180"])(
      "erkennt Rückzahlungen über Geld- und Privatkonto %s",
      (account) => {
        const lines = invoicePaymentPosting(totals, -119000, kr, "ist").map((line) => (line.account === ACCOUNTS[kr].bank ? { ...line, account } : line));
        expect(isExternalSettlementPayment(kr, lines)).toBe(true);
      },
    );

    it.each([true, false])("hält eine Anlagenrechnung nicht für eine Zahlung (Vorsteuerabzug: %s)", (vorsteuerAbzug) => {
      expect(isExternalSettlementPayment(kr, documentPosting(totals, "anlage", kr, "einzelunternehmen", "bank", vorsteuerAbzug))).toBe(false);
    });

    it.each([1, 9])("erkennt ungeklärte Zahlungen auf dem Zahlungsdienstleister-Verrechnungskonto %s", (index) => {
      const lines = invoicePaymentPosting(totals, 119000, kr, "ist").map((line) =>
        line.account === ACCOUNTS[kr].bank ? { ...line, account: paymentProviderAccount(kr, index) } : line,
      );
      expect(isExternalSettlementPayment(kr, lines)).toBe(true);
    });

    it.each([true, false])("nimmt die Zahlung auf eine Anlagenrechnung ohne Erfolgskonto an (Vorsteuerabzug: %s)", (vorsteuerAbzug) => {
      expect(
        externalSettlementProblem(kr, [
          { externalId: "anlage", date: "2026-01-15", lines: documentPosting(totals, "anlage", kr, "einzelunternehmen", "bank", vorsteuerAbzug) },
          { externalId: "zahlung-anlage", date: "2026-02-15", lines: documentPaymentPosting(-119000, kr), settles: "anlage" },
        ]),
      ).toBeNull();
    });

    it("nimmt die Auszahlung einer Gutschrift mit negativem OP an", () => {
      const credit = totalsFromTaxes([{ rate: 1900, base: -100000, tax: -19000 }]);
      expect(
        externalSettlementProblem(kr, [
          { externalId: "gutschrift", date: "2026-01-15", lines: invoicePosting(credit, kr, "ist") },
          { externalId: "auszahlung", date: "2026-02-15", lines: invoicePaymentPosting(credit, -119000, kr, "ist"), settles: "gutschrift" },
        ]),
      ).toBeNull();
    });

    it("nimmt Teilzahlungen und die Rückzahlung am selben Tag unabhängig von der Quellkennung an", () => {
      expect(
        externalSettlementProblem(kr, [
          original(kr),
          { ...payment(kr, 59500), externalId: "z1" },
          { ...payment(kr, 59500), externalId: "z2" },
          { ...payment(kr, -119000), externalId: "a-rueck" },
        ]),
      ).toBeNull();
    });

    it("nimmt einen belegten Zufluss vor dem Rechnungsdatum im Zahlungsjahr an (§ 11 EStG)", () => {
      expect(externalSettlementProblem(kr, [original(kr), { ...payment(kr), date: "2025-12-30" }])).toBeNull();
    });

    it.each([
      ["fehlender Posten", (kr: Kontenrahmen) => payment(kr, 119000, "fehlt")],
      ["Selbstbezug", (kr: Kontenrahmen) => payment(kr, 119000, "zahlung")],
      ["Überzahlung", (kr: Kontenrahmen) => payment(kr, 119001)],
      ["Rückzahlung ohne vorherigen Eingang", (kr: Kontenrahmen) => payment(kr, -1)],
      ["falsches OP-Konto", (kr: Kontenrahmen) => ({ ...payment(kr), lines: documentPaymentPosting(-119000, kr) })],
      ["doppelte Erlösbuchung", (kr: Kontenrahmen) => ({ ...payment(kr), lines: invoicePosting(totals, kr, "ist") })],
    ])("weist %s ab", (_name, invalid) => {
      expect(externalSettlementProblem(kr, [original(kr), invalid(kr)])).toMatch(/Zahlungsbezug ungültig/);
    });

    it("weist eine Zahlung auf eine andere Zahlungsbuchung ab", () => {
      expect(externalSettlementProblem(kr, [original(kr), payment(kr, 59500), { ...payment(kr, 59500, "zahlung"), externalId: "weiter" }])).toMatch(
        /Zahlungsbezug ungültig/,
      );
    });
  });

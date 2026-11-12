import { describe, expect, it } from "vitest";
import { externalSettlementProblem, type ExternalSettlementJournal } from "./external-settlements.ts";
import { documentPaymentPosting, invoicePaymentPosting, invoicePosting, type Kontenrahmen } from "./posting.ts";
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

import { describe, expect, it } from "vitest";
import { advancePaymentDateProblem } from "./anzahlung-bilanz.ts";

/** Bestätigte Grenze aus #750; der allgemeine Vorauszahlungsfall gehört zu #853. */
describe("Zahlungsdatum neuer Bilanz-Schlussketten", () => {
  const invoice = {
    kind: "rechnung" as const,
    variant: "schluss" as "abschlag" | "schluss" | null,
    advanceAccounting: "deferred" as "deferred" | null,
    issueDate: "2027-01-30",
    serviceFrom: "2027-01-10" as string | null,
    serviceTo: "2027-01-20" as string | null,
  };

  it("verwendet das Leistungsende statt Beginn oder Rechnungsdatum", () => {
    expect(advancePaymentDateProblem(invoice, "2027-01-19", 119)).toMatch(/Leistungsdatum.*Abschlagsrechnung/);
    expect(advancePaymentDateProblem(invoice, "2027-01-20", 119)).toBeNull();
  });

  it("verwendet ohne Zeitraum den Leistungstag und erst danach das Rechnungsdatum", () => {
    expect(advancePaymentDateProblem({ ...invoice, serviceTo: null }, "2027-01-10", 119)).toBeNull();
    expect(advancePaymentDateProblem({ ...invoice, serviceTo: null, serviceFrom: null }, "2027-01-29", 119)).not.toBeNull();
  });

  it.each([
    { ...invoice, advanceAccounting: null },
    { ...invoice, variant: null },
    { ...invoice, variant: "abschlag" as const },
  ])("belässt Altbelege, normale Rechnungen und Anzahlungsanforderungen bei ihren Zahlungswegen", (other) => {
    expect(advancePaymentDateProblem(other, "2026-12-01", 119)).toBeNull();
  });

  it("behandelt Gegenbewegungen nicht als neue Vorauszahlung", () => {
    expect(advancePaymentDateProblem(invoice, "2026-12-01", -119)).toBeNull();
  });
});

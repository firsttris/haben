import { describe, expect, it } from "vitest";
import { advancePaymentDateProblem } from "./anzahlung-bilanz.ts";

const soll = { versteuerung: "soll" as const, kapitalgesellschaft: false };

/** Bestätigte Grenze aus #750; der allgemeine Vorauszahlungsfall gehört zu #853. */
describe("Zahlungsdatum neuer Bilanz-Schlussketten", () => {
  const invoice = {
    kind: "rechnung" as const,
    variant: "schluss" as "abschlag" | "schluss" | null,
    advanceAccounting: "deferred" as "deferred" | null,
    issueDate: "2027-01-30",
    serviceFrom: "2027-01-10" as string | null,
    serviceTo: "2027-01-20" as string | null,
    currency: "EUR",
    taxTreatment: "regulaer" as const,
  };

  it("verwendet das Leistungsende statt Beginn oder Rechnungsdatum", () => {
    expect(advancePaymentDateProblem(invoice, "2027-01-19", 119, soll)).toMatch(/Leistungsdatum.*Abschlagsrechnung/);
    expect(advancePaymentDateProblem(invoice, "2027-01-20", 119, soll)).toBeNull();
  });

  it("verwendet ohne Zeitraum den Leistungstag und erst danach das Rechnungsdatum", () => {
    expect(advancePaymentDateProblem({ ...invoice, serviceTo: null }, "2027-01-10", 119, soll)).toBeNull();
    expect(advancePaymentDateProblem({ ...invoice, serviceTo: null, serviceFrom: null }, "2027-01-29", 119, soll)).not.toBeNull();
  });

  it.each([
    { ...invoice, advanceAccounting: null },
    { ...invoice, variant: null },
    { ...invoice, variant: "abschlag" as const },
  ])("belässt Altbelege, normale Rechnungen und Anzahlungsanforderungen bei ihren Zahlungswegen", (other) => {
    expect(advancePaymentDateProblem(other, "2026-12-01", 119, soll)).toBeNull();
  });

  it("behandelt Gegenbewegungen nicht als neue Vorauszahlung", () => {
    expect(advancePaymentDateProblem(invoice, "2026-12-01", -119, soll)).toBeNull();
  });
});

describe("Übergang normaler Alt-Rechnungen ohne Verfahrensmarker (#853)", () => {
  const invoice = {
    kind: "rechnung" as const,
    variant: null,
    advanceAccounting: null,
    currency: "EUR",
    taxTreatment: "regulaer" as const,
    issueDate: "2027-01-30",
    serviceFrom: "2027-01-10",
    serviceTo: "2027-01-20" as string | null,
  };

  it("sperrt eine neue Vorauszahlung vor dem dokumentierten Leistungsende und nennt Storno und neue Rechnung als Weg", () => {
    expect(advancePaymentDateProblem(invoice, "2027-01-19", 11_900, soll)).toEqual(expect.stringMatching(/Alt-Rechnung.*Storniere sie.*Leistungszeitraum neu/));
    expect(advancePaymentDateProblem({ ...invoice, serviceTo: null }, "2027-01-09", 11_900, soll)).not.toBeNull();
  });

  it("lässt Zahlung ab Leistung auch vor Rechnungsdatum und Gegenbewegungen zu", () => {
    expect(advancePaymentDateProblem(invoice, "2027-01-20", 11_900, soll)).toBeNull();
    expect(advancePaymentDateProblem(invoice, "2027-01-21", 11_900, soll)).toBeNull();
    expect(advancePaymentDateProblem(invoice, "2027-01-09", -11_900, soll)).toBeNull();
    expect(advancePaymentDateProblem(invoice, "2027-01-09", 0, soll)).toBeNull();
  });

  it("sperrt nur bei Soll oder GmbH/UG; bei Ist ohne Bilanz stimmt der bisherige Weg schon", () => {
    expect(advancePaymentDateProblem(invoice, "2027-01-19", 11_900, { versteuerung: "ist", kapitalgesellschaft: true })).not.toBeNull();
    expect(advancePaymentDateProblem(invoice, "2027-01-19", 11_900, { versteuerung: "soll", kapitalgesellschaft: false })).not.toBeNull();
    expect(advancePaymentDateProblem(invoice, "2027-01-19", 11_900, { versteuerung: "ist", kapitalgesellschaft: false })).toBeNull();
  });

  it("rät ohne Leistungsangabe keine Vorauszahlung aus dem Rechnungsdatum", () => {
    expect(advancePaymentDateProblem({ ...invoice, serviceFrom: null, serviceTo: null }, "2027-01-09", 11_900, soll)).toBeNull();
  });

  it.each([
    { ...invoice, advanceAccounting: "deferred" as const },
    { ...invoice, currency: "USD" },
    { ...invoice, taxTreatment: "kleinunternehmer" as const },
    { ...invoice, taxTreatment: "reverse_charge" as const },
    { ...invoice, taxTreatment: "drittland" as const },
    { ...invoice, kind: "storno" as const },
    { ...invoice, kind: "korrektur" as const },
    { ...invoice, variant: "abschlag" as const },
    { ...invoice, variant: "schluss" as const },
  ])("erweitert nur den entschiedenen normalen EUR-Inlandsaltfall: %j", (other) => {
    expect(advancePaymentDateProblem(other, "2027-01-09", 11_900, soll)).toBeNull();
  });
});

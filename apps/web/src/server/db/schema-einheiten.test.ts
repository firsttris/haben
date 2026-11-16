import type { BasisPoints, Cents, Millis } from "@haben/core";
import { describe, expectTypeOf, it } from "vitest";
import type {
  company,
  dividends,
  documents,
  invoiceLines,
  invoices,
  journalLines,
  lexofficeVouchers,
  payslips,
  recurringDocuments,
  vatReturns,
} from "./schema.ts";

// Geprüft im Typecheck (`bun run typecheck`), zur Laufzeit tut expectTypeOf nichts. Die Spalten tragen ihre Einheit über
// `$type`; in der Datenbank bleiben es ganze Zahlen (#1132).
type Zeile<T extends { $inferSelect: unknown }> = T["$inferSelect"];

describe("Einheiten der Spalten", () => {
  it("Rechnungen: Beträge in Cent, Sätze in Basispunkten, Mengen in Tausendsteln", () => {
    expectTypeOf<Zeile<typeof invoices>["gross"]>().toEqualTypeOf<Cents>();
    expectTypeOf<Zeile<typeof invoices>["discountPercent"]>().toEqualTypeOf<BasisPoints | null>();
    expectTypeOf<Zeile<typeof invoiceLines>["unitPrice"]>().toEqualTypeOf<Cents>();
    expectTypeOf<Zeile<typeof invoiceLines>["taxRate"]>().toEqualTypeOf<BasisPoints>();
    expectTypeOf<Zeile<typeof invoiceLines>["quantity"]>().toEqualTypeOf<Millis>();
  });

  it("Voranmeldung, Belege, Journal und Lohn", () => {
    expectTypeOf<Zeile<typeof vatReturns>["kz83"]>().toEqualTypeOf<Cents>();
    expectTypeOf<Zeile<typeof documents>["vorsteuerAnteil"]>().toEqualTypeOf<BasisPoints | null>();
    expectTypeOf<Zeile<typeof journalLines>["debit"]>().toEqualTypeOf<Cents>();
    expectTypeOf<Zeile<typeof payslips>["auszahlung"]>().toEqualTypeOf<Cents>();
  });

  it("Beträge und Sätze in JSON-Spalten", () => {
    expectTypeOf<Zeile<typeof company>["dunning"]["baseRate"]>().toEqualTypeOf<BasisPoints | null>();
    expectTypeOf<Zeile<typeof company>["dunning"]["fees"]["1"]>().toEqualTypeOf<Cents>();
    expectTypeOf<Zeile<typeof recurringDocuments>["amounts"][number]["net"]>().toEqualTypeOf<Cents>();
    expectTypeOf<NonNullable<Zeile<typeof vatReturns>["computed"]>["kz83"]>().toEqualTypeOf<Cents>();
    expectTypeOf<Zeile<typeof dividends>["empfaenger"][number]["anteil"]>().toEqualTypeOf<BasisPoints>();
    expectTypeOf<Zeile<typeof lexofficeVouchers>["taxes"][number]["rate"]>().toEqualTypeOf<BasisPoints>();
  });
});

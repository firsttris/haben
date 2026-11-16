import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { z as zm } from "zod/mini";
import { type dunningAmounts, lateInterest } from "./dunning.ts";
import { inBasisPoints, inCents, inMillis } from "./einheit-schema.ts";
import type { invoiceLineInputSchema, Millis, TaxRate } from "./invoice.ts";
import type { BasisPoints, Cents } from "./money.ts";
import { discountColumns, discountFromColumns, type discountSchema } from "./rabatt.ts";
import type { skontoStufeSchema } from "./skonto.ts";

// Die Typen prüft der Typecheck (`bun run typecheck`): expectTypeOf tut zur Laufzeit nichts, und kompiliert eine Zeile unter
// `@ts-expect-error` doch, meldet tsc die Direktive als unbenutzt (#1132).
const nullbar = () => inCents(z.number().int()).nullable();

describe("Zod-Schemas mit Einheit", () => {
  it("geben dasselbe Schema zurück: gleiche Prüfung, gleiches JSON-Schema", () => {
    const schema = z.number().int().min(1, "Betrag fehlt");
    expect(inCents(schema)).toBe(schema);
    expect(inCents(schema).safeParse(0).error?.issues[0]?.message).toBe("Betrag fehlt");
    const mini = zm.int().check(zm.maximum(10_000));
    expect(inBasisPoints(mini)).toBe(mini);
    expect(inMillis(mini)).toBe(mini);
  });

  it("Zod prüft schon auf eine ganze Zahl im sicheren Bereich", () => {
    const klassisch = z.number().int();
    expect(klassisch.safeParse(2 ** 53).success).toBe(false);
    expect(klassisch.safeParse(1.5).success).toBe(false);
    expect(zm.int().safeParse(2 ** 53).success).toBe(false);
  });

  it("das Ergebnis trägt die Einheit, die Eingabe bleibt eine Zahl", () => {
    expectTypeOf<z.output<typeof invoiceLineInputSchema>["unitPrice"]>().toEqualTypeOf<Cents>();
    expectTypeOf<z.output<typeof invoiceLineInputSchema>["quantity"]>().toEqualTypeOf<Millis>();
    expectTypeOf<z.input<typeof invoiceLineInputSchema>["quantity"]>().toEqualTypeOf<number>();
    expectTypeOf<z.output<typeof invoiceLineInputSchema>["taxRate"]>().toEqualTypeOf<TaxRate & BasisPoints>();
    expectTypeOf<z.output<typeof skontoStufeSchema>["percent"]>().toEqualTypeOf<BasisPoints>();
    expectTypeOf<z.output<typeof discountSchema>>().toEqualTypeOf<{ kind: "prozent"; value: BasisPoints } | { kind: "betrag"; value: Cents }>();
    expectTypeOf<z.output<ReturnType<typeof nullbar>>>().toEqualTypeOf<Cents | null>();
    // @ts-expect-error Der Helfer nimmt nur ein Schema für eine Zahl; .nullable() und .optional() kommen danach
    expect(inCents(z.number().nullable()).safeParse(null).success).toBe(true);
  });
});

describe("Spalten des Rabatts und Zinssatz der Mahnung", () => {
  const satz: BasisPoints = 1000;
  const betrag: Cents = 5000;

  it("vertauschte Argumente kompilieren nicht", () => {
    expect(discountFromColumns(satz, null)).toEqual({ kind: "prozent", value: 1000 });
    // @ts-expect-error Cent sind keine Basispunkte
    expect(discountFromColumns(betrag, null)).toEqual({ kind: "prozent", value: 5000 });
    expect(lateInterest(betrag, satz, 365)).toBe(500);
    // @ts-expect-error Cent sind kein Zinssatz
    expect(lateInterest(betrag, betrag, 365)).toBe(2500);
  });

  it("Spalten des Rabatts und Zinssatz der Mahnung tragen die Einheit", () => {
    expectTypeOf(discountColumns(null)).toEqualTypeOf<{ discountPercent: BasisPoints | null; discountAmount: Cents | null }>();
    expectTypeOf<ReturnType<typeof dunningAmounts>["interestRate"]>().toEqualTypeOf<BasisPoints>();
  });
});

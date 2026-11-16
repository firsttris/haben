import type { BasisPoints, Cents, Millis } from "@haben/core";
import { describe, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import type { invoiceSchema, invoiceSummarySchema } from "./schemas.ts";

// Geprüft im Typecheck (`bun run typecheck`), zur Laufzeit tut expectTypeOf nichts. Das JSON der REST-API bleibt gleich,
// nur die Werte nach dem Prüfen tragen ihre Einheit (#1132).
type Rechnung = z.output<typeof invoiceSchema>;

describe("Einheiten in den Schemas der REST-API", () => {
  it("Rechnung: Beträge in Cent, Sätze in Basispunkten, Mengen in Tausendsteln", () => {
    expectTypeOf<z.output<typeof invoiceSummarySchema>["open"]>().toEqualTypeOf<Cents>();
    expectTypeOf<Rechnung["lines"][number]["quantity"]>().toEqualTypeOf<Millis>();
    expectTypeOf<Rechnung["lines"][number]["unitPrice"]>().toEqualTypeOf<Cents>();
    expectTypeOf<Rechnung["lines"][number]["taxRate"]>().toEqualTypeOf<BasisPoints>();
    expectTypeOf<Rechnung["skonto"][number]["percent"]>().toEqualTypeOf<BasisPoints>();
  });

  it("die Eingabe bleibt eine Zahl", () => {
    expectTypeOf<z.input<typeof invoiceSummarySchema>["open"]>().toEqualTypeOf<number>();
  });
});

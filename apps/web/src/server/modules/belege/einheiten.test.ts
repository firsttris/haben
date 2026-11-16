import type { BasisPoints, Prozent } from "@haben/core";
import { describe, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import type { dauerbelegInputSchema } from "./dauerbelege.ts";
import type { documentInputSchema } from "./documents.ts";

// Geprüft im Typecheck (`bun run typecheck`), zur Laufzeit tut expectTypeOf nichts (#1132).
describe("Einheiten in den Eingaben der Belege", () => {
  it("Privatanteil in ganzen Prozent, Abzugsanteil in Basispunkten", () => {
    expectTypeOf<z.output<typeof documentInputSchema>["privateShare"]>().toEqualTypeOf<Prozent>();
    expectTypeOf<z.output<typeof documentInputSchema>["vorsteuerAnteil"]>().toEqualTypeOf<BasisPoints | null>();
    expectTypeOf<z.output<typeof dauerbelegInputSchema>["privateShare"]>().toEqualTypeOf<Prozent>();
  });

  it("die Eingabe bleibt eine Zahl", () => {
    expectTypeOf<z.input<typeof documentInputSchema>["privateShare"]>().toEqualTypeOf<number | undefined>();
  });
});

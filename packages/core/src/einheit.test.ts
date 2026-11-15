import { describe, expect, it } from "vitest";
import { lineAmount, type Millis } from "./invoice.ts";
import { taxOf, type BasisPoints, type Cents } from "./money.ts";

// Geprüft wird im Typecheck (`bun run typecheck`): Kompiliert eine Zeile unter `@ts-expect-error` doch, meldet tsc die
// Direktive als unbenutzt. Zur Laufzeit rechnet jede Zeile wie gewohnt, die Einheit steht nur im Typ (#1132).
describe("Einheiten von Cent, Basispunkten und Tausendsteln", () => {
  const netto: Cents = 10_000;
  const satz: BasisPoints = 1900;
  const menge: Millis = 2000;

  it("vertauschte Argumente kompilieren nicht", () => {
    // @ts-expect-error Basispunkte sind keine Cent
    expect(taxOf(satz, netto)).toBe(1900);
    // @ts-expect-error Cent sind keine Tausendstel
    expect(lineAmount(netto, menge)).toBe(20_000);
  });

  it("eine Einheit passt nicht an die Stelle einer anderen", () => {
    // @ts-expect-error Basispunkte sind keine Cent
    const betrag: Cents = satz;
    // @ts-expect-error Tausendstel sind keine Basispunkte
    const rate: BasisPoints = menge;
    expect([betrag, rate]).toEqual([1900, 2000]);
  });

  it("eine Zahl ohne Einheit passt weiterhin", () => {
    expect(taxOf(10_000, 1900)).toBe(1900);
    expect(lineAmount(1500, 8000)).toBe(12_000);
  });
});

import { describe, expect, it } from "vitest";
import { computeEuer } from "./euer.ts";

/** EÜR-Anleitung 2025, Zeilen 18 und 58: nur tatsächliche Zahlungen bzw. Erstattungen.
 * https://www.elster.de/eportal/helpGlobal?themaGlobal=help_euer_ufa_77_2025 */
describe("USt-Rücknahme ohne die ursprüngliche Zahlung im EÜR-Jahr", () => {
  for (const kind of ["ustVorauszahlung", "sondervorauszahlung"] as const) {
    it(`${kind}: Rücknahme einer Zahlung mindert Ausgaben; echte Erstattung bleibt Einnahme`, () => {
      const result = computeEuer(2027, [
        { kind, date: "2027-01-08", amount: 19_000, ustAbfluss: true },
        { kind, date: "2027-01-15", amount: 5_000, ustAbfluss: false },
      ]);
      expect(result.ausgaben.find((l) => l.key === "gezahlteUst")?.amount).toBe(-19_000);
      expect(result.einnahmen.find((l) => l.key === "erstatteteUst")?.amount).toBe(5_000);
      expect(result.gewinn).toBe(24_000);
    });

    it(`${kind}: Rücknahme einer Erstattung mindert Einnahmen; echte Zahlung bleibt Ausgabe`, () => {
      const result = computeEuer(2027, [
        { kind, date: "2027-01-08", amount: -19_000, ustAbfluss: false },
        { kind, date: "2027-01-15", amount: -5_000, ustAbfluss: true },
      ]);
      expect(result.einnahmen.find((l) => l.key === "erstatteteUst")?.amount).toBe(-19_000);
      expect(result.ausgaben.find((l) => l.key === "gezahlteUst")?.amount).toBe(5_000);
      expect(result.gewinn).toBe(-24_000);
    });
  }
});

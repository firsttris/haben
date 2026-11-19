import { readFileSync } from "node:fs";
import { evatrFrischGueltig, evatrZeitpunkt } from "@haben/core";
import { describe, expect, it } from "vitest";

/*
 * Review zu #1458: Die E2E-Tests in e2e/ustid-bestaetigung.ts erwarten nach einer gültigen Antwort der Attrappe, dass sie
 * frisch ist („Eine gültige Antwort von eben reicht: keine weitere Abfrage“; in der ZM „Jede gemeldete USt-IdNr. hat eine
 * gültige Bestätigung … aus den letzten 30 Tagen“ und kein Knopf mehr). Frisch heißt höchstens EVATR_FRIST_TAGE vor
 * new Date() auf dem Server (evatrFrischGueltig). Antwortet die Attrappe mit einem festen anfrageZeitpunkt, kippen beide
 * Tests, sobald die CI mehr als 30 Tage danach läuft.
 */

const attrappe = readFileSync(new URL("../../../../e2e/ustid-bestaetigung.ts", import.meta.url), "utf8");

describe("Review #1458: Zeitpunkt der eVatR-Attrappe in den E2E-Tests", () => {
  it("eine gültige Antwort der Attrappe ist auch bei einem Lauf der CI in einem Monat noch frisch", () => {
    const feste = [...attrappe.matchAll(/anfrageZeitpunkt: "([^"]+)"/g)].map((m) => m[1]!);
    const laufInEinemMonat = new Date(Date.now() + 31 * 86_400_000);
    for (const zeitpunkt of feste) {
      expect(evatrFrischGueltig({ status: "evatr-0000", anfrageZeitpunkt: evatrZeitpunkt(zeitpunkt)! }, laufInEinemMonat), zeitpunkt).toBe(true);
    }
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KIRCHENSTEUER_HINWEIS } from "../../../lib/kirchensteuer.ts";

/**
 * Der Hinweis steht am Feld „Gezahlte Kirchensteuer“ (#1451). Ein Bild des Formulars gibt es im Unit-Test nicht, die
 * Seite braucht die kompletten Loader-Daten; deshalb prüft der Test die Stelle im Quelltext: Das Feld muss den
 * gemeinsamen Hinweis tragen, und der alte, zu kurze Text darf nicht mehr dort stehen.
 */
const quelle = readFileSync(new URL("./$jahr.tsx", import.meta.url), "utf8");

describe("Hinweis am Feld Gezahlte Kirchensteuer (#1451)", () => {
  it("gibt dem Feld kistGezahlt den Hinweis aus lib/kirchensteuer.ts mit", () => {
    const feld = quelle.slice(quelle.indexOf('name="kistGezahlt"'));
    expect(feld.indexOf("hint={KIRCHENSTEUER_HINWEIS}"), "hint am Feld").toBeGreaterThan(-1);
    expect(feld.indexOf("hint={KIRCHENSTEUER_HINWEIS}")).toBeLessThan(feld.indexOf("/>"));
  });

  it("trägt den alten Text „ohne Kirchensteuer auf Kapitalerträge“ nicht mehr als Hinweis", () => {
    expect(quelle).not.toContain('hint="ohne Kirchensteuer auf Kapitalerträge"');
    expect(KIRCHENSTEUER_HINWEIS).toContain("Lohnkirchensteuer");
  });
});

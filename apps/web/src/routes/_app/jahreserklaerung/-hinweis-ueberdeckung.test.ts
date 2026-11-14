import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Der Hinweis zu den Beträgen stand im Markup hinter der klebenden Knopfzeile (`.form-sticky-footer`). Die Zeile klebt
 * unten, hat einen eigenen Hintergrund und zieht mit `margin-bottom: -20px` über den Rand der Karte; was hinter ihr steht,
 * liegt dauerhaft darunter. Ein Browser steht im Unit-Test nicht zur Verfügung, deshalb prüft der Test die Reihenfolge im
 * Quelltext: Der Hinweis muss vor der Knopfzeile stehen.
 */
const quelle = readFileSync(new URL("./$jahr.tsx", import.meta.url), "utf8");

const stelle = (text: string) => {
  const index = quelle.indexOf(text);
  expect(index, `nicht gefunden: ${text}`).toBeGreaterThan(-1);
  return index;
};

const FOOTER = 'className="form-sticky-footer"';

describe("Euro-Hinweis im Einkommensteuer-Formular (#871)", () => {
  it("steht vor der klebenden Knopfzeile, damit ihn der Footer nicht überdeckt", () => {
    expect(stelle("Beträge in Euro; ELSTER bekommt volle Euro")).toBeLessThan(stelle(FOOTER));
  });

  it("lässt hinter der Knopfzeile keinen Hinweis mehr stehen, der verdeckt würde", () => {
    const hinter = quelle.slice(stelle(FOOTER) + FOOTER.length);
    expect(hinter.slice(0, hinter.indexOf("</form>"))).not.toContain("Beträge in Euro");
  });
});

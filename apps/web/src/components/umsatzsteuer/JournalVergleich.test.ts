import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JournalVergleich } from "./JournalVergleich.tsx";

const gesendet = { id: "a", status: "sent", berichtigt: false, correctsId: null, kz81: 100_000, kz83: 19_000 };
const entwurf = { id: "b", status: "draft", berichtigt: true, correctsId: "a", kz81: 100_000, kz83: 19_000 };

const render = (uebernommen: boolean, current = entwurf) =>
  renderToStaticMarkup(createElement(JournalVergleich, { year: 2026, uebernommen, current, returns: [current, gesendet], journal: { kz81: 0, kz83: 0 } }));

describe("JournalVergleich", () => {
  it("erscheint nur beim Entwurf einer Berichtigung in einem übernommenen Jahr", () => {
    expect(render(false)).toBe("");
    expect(render(true, { ...entwurf, berichtigt: false, correctsId: null })).toBe("");
    expect(render(true)).toContain("Gesendet und Journal je Kennzahl");
  });

  /*
   * § 153 Abs. 1 Satz 1 Nr. 1 AO: Erkennt der Steuerpflichtige, dass die abgegebene Erklärung unrichtig ist, hat er sie
   * richtigzustellen. Die Differenz zum Journal kann aus der Übernahme stammen, aber auch zeigen, dass der gesendete Wert
   * falsch war; dann gehört sie in die Berichtigung. „Nur was sich seit der Anmeldung geändert hat“ wäre zu eng.
   */
  it("verlangt, einen als falsch erkannten gesendeten Wert mitzuberichtigen (§ 153 AO)", () => {
    const html = render(true);
    expect(html).not.toContain("seit der Anmeldung");
    expect(html).toContain("§ 153 AO");
  });
});

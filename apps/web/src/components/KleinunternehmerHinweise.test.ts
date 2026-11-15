import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KleinunternehmerHinweise } from "./KleinunternehmerHinweise.tsx";

function hinweise(netto: number) {
  return renderToStaticMarkup(
    createElement(KleinunternehmerHinweise, {
      stand: {
        jahr: 2026,
        gruendungsjahr: false,
        aktuell: { netto, ungeklaert: false },
        vorjahr: { netto: 0, ungeklaert: false },
        naheAktuell: false,
        vorjahresgrenzeUeberschritten: false,
        jahresgrenze: 10_000_000,
        vorjahresgrenze: 2_500_000,
      },
    }),
  );
}

describe("Kleinunternehmerhinweise für das Folgejahr (#717)", () => {
  it("warnt ab 20.000 Euro vereinnahmtem Umsatz vor der Grenze für das Folgejahr", () => {
    expect(hinweise(1_999_999)).toBe("");
    const html = hinweise(2_000_000);
    expect(html).toContain("im Jahr 2027");
    expect(html).toContain("25.000");
    expect(html).not.toContain("100.000");
    expect(html).not.toContain("bereits darüber");
  });

  it("weist bei 25.000,01 Euro auf die Überschreitung für das Folgejahr hin", () => {
    expect(hinweise(2_500_000)).not.toContain("bereits darüber");
    expect(hinweise(2_500_001)).toContain("bereits darüber");
  });
});

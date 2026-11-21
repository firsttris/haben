import { FORM01, kennzahlen, type Form01Werte } from "@haben/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BwaBericht } from "../server/modules/auswertungen/index.ts";
import { BwaKennzahlen } from "./BwaKennzahlen.tsx";

const werte = (material: number): Form01Werte => ({
  ...(Object.fromEntries(FORM01.map((d) => [d.key, 0])) as Form01Werte),
  umsatzerloese: 100_000,
  gesamtleistung: 100_000,
  material,
  rohertrag: 100_000 - material,
});

const bericht = (material: number) => {
  const k = kennzahlen("form01", werte(material));
  return { vergleich: null, kennzahlen: { zeitraum: k, kumuliert: k, vergleich: null, vergleichKumuliert: null } } as unknown as BwaBericht;
};

describe("BwaKennzahlen (#1635)", () => {
  // DESIGN.md, Karten: `.grid-5` für fünf Kennzahlen, damit sie am Desktop in einer Reihe stehen
  it("fünf Kennzahlen mit Aufschlag in grid-5, vier in grid-4", () => {
    const fuenf = renderToStaticMarkup(createElement(BwaKennzahlen, { bericht: bericht(40_000) }));
    expect(fuenf.match(/class="card"/g)).toHaveLength(5);
    expect(fuenf).toContain('class="grid-5 bwa-kennzahlen"');
    const vier = renderToStaticMarkup(createElement(BwaKennzahlen, { bericht: bericht(0) }));
    expect(vier.match(/class="card"/g)).toHaveLength(4);
    expect(vier).toContain('class="grid-4 bwa-kennzahlen"');
  });
});

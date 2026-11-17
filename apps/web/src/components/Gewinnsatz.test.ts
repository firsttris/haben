import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Gewinnsatz, gewinnSatz } from "./Gewinnsatz.tsx";

const euer = (totalEinnahmen: number, totalAusgaben: number) => ({ year: 2026, totalEinnahmen, totalAusgaben, gewinn: totalEinnahmen - totalAusgaben });

describe("Gewinnsatz", () => {
  it("nennt den Gewinn mit den Summen, aus denen er sich ergibt", () => {
    expect(gewinnSatz(euer(595_000, 119_000))).toBe(
      "Du hast 2026 4.760,00 € Gewinn gemacht: Einnahmen 5.950,00 € minus Ausgaben 1.190,00 € (brutto, wie in der EÜR).",
    );
  });

  it("nennt bei negativem Ergebnis den Verlust ohne Minuszeichen", () => {
    const satz = gewinnSatz(euer(10_000, 25_050));
    expect(satz).toContain("Du hast 2026 150,50 € Verlust gemacht");
    expect(satz).toContain("Einnahmen 100,00 € minus Ausgaben 250,50 €");
    expect(satz).not.toContain("-");
  });

  it("nennt bei gleichen Summen einen Gewinn von null", () => {
    expect(gewinnSatz(euer(50_000, 50_000))).toContain("0,00 € Gewinn");
  });

  it("sagt nichts in einem Jahr ohne Einnahmen und Ausgaben", () => {
    expect(gewinnSatz(euer(0, 0))).toBeNull();
    expect(renderToStaticMarkup(createElement(Gewinnsatz, { euer: euer(0, 0) }))).toBe("");
  });

  it("steht als Absatz auf der Seite", () => {
    expect(renderToStaticMarkup(createElement(Gewinnsatz, { euer: euer(10_000, 2_000) }))).toContain("<p");
  });
});

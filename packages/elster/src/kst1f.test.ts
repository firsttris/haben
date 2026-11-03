import { describe, expect, it } from "vitest";
import { einlagekontoRechnung, kst1fNode, type Kst1fInput } from "./kst1f.ts";
import { render } from "./erklaerung.ts";

/*
 * Anlage KSt 1 F: Verwendungsrechnung des Einlagekontos (§ 27 Abs. 1 Satz 3 KStG) mit den Regeln der Jahresdokumentation
 * 30_2025 (KSt1F_22_020: Abzug = Max(Min(Zeile 46, Zeile 49, Zeile 12), 0); Regel_082003: ausschüttbarer Gewinn =
 * Max(Eigenkapital − Nennkapital − Einlagekonto, 0)).
 */
const basis: Kst1fInput = { year: 2025, einlagekonto: 0, leistungen: [], eigenkapital: 0, nennkapital: 0 };
const xml = (input: Kst1fInput) => render(kst1fNode(input), "").join("\n");

describe("Anlage KSt 1 F", () => {
  it("ohne Ausschüttung: Bestand unverändert, keine Leistungen und kein ausschüttbarer Gewinn", () => {
    const r = einlagekontoRechnung({ ...basis, einlagekonto: 500_000 });
    expect(r).toMatchObject({ anfang: 5000, leistungen: 0, ausschuettbarerGewinn: null, abzug: 0, ende: 5000 });
    const x = xml({ ...basis, einlagekonto: 500_000 });
    expect(x).not.toContain("Leistungen");
    expect(x).not.toContain("<Gewinn>");
    expect(x).toContain("<E8245601>5000</E8245601>");
  });

  it("Ausschüttung aus dem ausschüttbaren Gewinn: das Einlagekonto bleibt", () => {
    const input = {
      ...basis,
      einlagekonto: 500_000,
      eigenkapital: 5_000_000,
      nennkapital: 2_500_000,
      leistungen: [{ beschluss: "2025-06-15", abfluss: "2025-06-30", brutto: 1_000_050, ausEinlagekonto: 0 }],
    };
    // 50.000 − 25.000 − 5.000 = 20.000 € ausschüttbar, 10.000 € ausgeschüttet
    expect(einlagekontoRechnung(input)).toMatchObject({ leistungen: 10_000, ausschuettbarerGewinn: 20_000, summe: -10_000, abzug: 0, ende: 5000 });
    const x = xml(input);
    expect(x).toContain("<E8122020>1</E8122020>");
    expect(x).toContain("<E8122021>15.06.2025</E8122021>");
    expect(x).toContain("<E8122022>30.06.2025</E8122022>");
    expect(x).toContain("<E8122023>10000</E8122023>");
    expect(x).toContain("<E8122024>0</E8122024>");
    expect(x).toContain("<E8201301>20000</E8201301>");
    expect(x).toContain("<E8240501>-10000</E8240501>");
    expect(x).not.toContain("E8241717");
    expect(x).not.toContain("E8242201");
  });

  it("Ausschüttung über dem ausschüttbaren Gewinn: der bescheinigte Teil mindert das Einlagekonto", () => {
    const input = {
      ...basis,
      einlagekonto: 500_000,
      eigenkapital: 5_000_000,
      nennkapital: 2_500_000,
      leistungen: [{ beschluss: "2025-04-01", abfluss: "2025-04-02", brutto: 2_200_000, ausEinlagekonto: 200_000 }],
    };
    expect(einlagekontoRechnung(input)).toMatchObject({ summe: 2000, mehrere: false, abzug: 2000, ende: 3000 });
    const x = xml(input);
    expect(x).toContain("<E8241717>5000</E8241717>");
    expect(x).toContain("<E8242201>2000</E8242201>");
    expect(x).toContain("<E8245601>3000</E8245601>");
    // Ohne Bescheinigung keine Minderung (§ 27 Abs. 5 Satz 2 KStG)
    expect(einlagekontoRechnung({ ...input, leistungen: [{ ...input.leistungen[0]!, ausEinlagekonto: 0 }] })).toMatchObject({ abzug: 0, ende: 5000 });
  });

  it("mehrere Leistungen mit Bescheinigung: Zeile 13 und Abzug laut Zeile 51, höchstens der Bestand", () => {
    const input = {
      ...basis,
      einlagekonto: 500_000,
      eigenkapital: 5_000_000,
      nennkapital: 2_500_000,
      leistungen: [
        { beschluss: "2025-03-01", abfluss: "2025-03-02", brutto: 1_500_000, ausEinlagekonto: 0 },
        { beschluss: "2025-09-01", abfluss: "2025-09-02", brutto: 1_000_000, ausEinlagekonto: 500_000 },
      ],
    };
    expect(einlagekontoRechnung(input)).toMatchObject({ leistungen: 25_000, bescheinigt: 5000, mehrere: true, abzug: 5000, ende: 0 });
    const x = xml(input);
    expect(x).toContain("<E8122011>1</E8122011>");
    expect(x).toContain("<E8242202>5000</E8242202>");
    expect(x).not.toContain("E8242201");
  });
});

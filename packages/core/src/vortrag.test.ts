import { describe, expect, it } from "vitest";
import { kontoart } from "./ledger.ts";
import { carriesForward, carryForward } from "./vortrag.ts";

describe("Saldenvortrag", () => {
  it.each([
    ["SKR03", ["0730", "0800", "1200", "1400", "1576", "1776", "3980", "7000", "9000"], ["2650", "3100", "4900", "8400"]],
    ["SKR04", ["0520", "1200", "1800", "2900", "2970", "3510", "3806", "9000"], ["4400", "5900", "6300", "7100"]],
  ] as const)("%s: Bestandskonten tragen vor, Erfolgskonten nicht", (kr, bestand, erfolg) => {
    for (const account of bestand) expect(carriesForward(kr, account), account).toBe(true);
    for (const account of erfolg) expect(carriesForward(kr, account), account).toBe(false);
  });

  it("SKR03 3970–3999 sind Bestände, der Rest der Klasse 3 Wareneingang", () => {
    expect(kontoart("SKR03", "3969")).toBe("aufwand");
    expect(kontoart("SKR03", "3970")).toBe("bestand");
    expect(kontoart("SKR03", "3999")).toBe("bestand");
  });

  it.each([
    ["SKR03", "0860", "0868", "1200", "8400", "4900", "0730"],
    ["SKR04", "2970", "2978", "1800", "4400", "6300", "3510"],
  ] as const)("%s: Gewinn auf Gewinnvortrag, Verlust auf Verlustvortrag, Summe bleibt null", (kr, gewinn, verlust, bank, erloes, aufwand, gesellschafter) => {
    // Bank 10.000 im Soll, Gesellschafter 2.000 im Haben, Erlöse 12.000, Aufwand 4.000: Gewinn 8.000
    const prior = [
      { account: bank, saldo: 1_000_000 },
      { account: gesellschafter, saldo: -200_000 },
      { account: erloes, saldo: -1_200_000 },
      { account: aufwand, saldo: 400_000 },
    ];
    const vortrag = carryForward(kr, prior);
    expect(Object.fromEntries(vortrag)).toEqual({ [bank]: 1_000_000, [gesellschafter]: -200_000, [gewinn]: -800_000 });
    expect([...vortrag.values()].reduce((s, v) => s + v, 0)).toBe(0);

    const loss = carryForward(kr, [
      { account: bank, saldo: -100_000 },
      { account: aufwand, saldo: 100_000 },
    ]);
    expect(Object.fromEntries(loss)).toEqual({ [bank]: -100_000, [verlust]: 100_000 });
  });

  it("ohne Ergebnis kein Vortragskonto, Salden 0 fallen weg", () => {
    expect(Object.fromEntries(carryForward("SKR04", [{ account: "1800", saldo: 0 }]))).toEqual({});
  });
});

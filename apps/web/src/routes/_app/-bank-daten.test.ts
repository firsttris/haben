import { describe, expect, it } from "vitest";
import { type Detail, type Posten, restAngebot } from "./-bank-daten.ts";

// Rechnung über 119,00 €, Korrektur über −23,80 €, der Kunde zahlt 95,20 € (#1398)
const korrektur = { id: "k1", number: "RE-2026-0002", open: -2380 };
const rechnung = (openCorrections?: (typeof korrektur)[]) =>
  ({ type: "invoice", id: "r1", number: "RE-2026-0001", date: "2026-11-02", open: 11_900, partyName: "Kunde", partyIbans: [], openCorrections }) as Posten;
const zahlung = (open: number) => ({ id: "t1", amount: open, open }) as Detail["transaction"];

describe("Rest einer Zahlung mit offener Korrektur (#1398)", () => {
  it("bietet bei „Rechnung minus Korrektur“ die Korrektur an statt Skonto, Forderungsausfall oder Gebühr", () => {
    const angebot = restAngebot(rechnung([korrektur]), zahlung(9520));
    expect(angebot.korrektur).toEqual(korrektur);
    expect(angebot.restKinds).toEqual([]);
    expect(angebot.feeRest).toBe(0);
    expect(angebot.rest).toBe(2380);
  });

  it("wählt unter mehreren offenen Korrekturen die, die den Rest genau ausgleicht", () => {
    const andere = { id: "k0", number: "RE-2026-0003", open: -1000 };
    expect(restAngebot(rechnung([andere, korrektur]), zahlung(9520)).korrektur).toEqual(korrektur);
  });

  it("bleibt bei Skonto und Forderungsausfall, wenn der Rest nicht zur Korrektur passt", () => {
    const angebot = restAngebot(rechnung([korrektur]), zahlung(9000));
    expect(angebot.korrektur).toBeUndefined();
    expect(angebot.restKinds).toEqual(["skonto", "forderungsausfall"]);
    expect(angebot.feeRest).toBe(-2900);
  });

  it("bleibt bei Skonto und Forderungsausfall ohne offene Korrektur", () => {
    const angebot = restAngebot(rechnung(), zahlung(9520));
    expect(angebot.korrektur).toBeUndefined();
    expect(angebot.restKinds).toEqual(["skonto", "forderungsausfall"]);
  });

  it("bietet bei voller Zahlung keine Korrektur an", () => {
    expect(restAngebot(rechnung([korrektur]), zahlung(11_900)).korrektur).toBeUndefined();
  });
});

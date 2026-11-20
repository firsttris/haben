import { describe, expect, it } from "vitest";
import { type Detail, type Posten, restAngebot } from "./-bank-daten.ts";

// Rechnung über 119,00 €, Korrektur über −23,80 €, der Kunde zahlt 95,20 € (#1398)
const korrektur = { id: "k1", number: "RE-2026-0002", open: -2380 };
const rechnung = (openCorrections?: (typeof korrektur)[]) =>
  ({ type: "invoice", id: "r1", number: "RE-2026-0001", date: "2026-11-02", open: 11_900, partyName: "Kunde", partyIbans: [], openCorrections }) as Posten;
const zahlung = (open: number) => ({ id: "t1", amount: open, open, bookingDate: "2026-11-06" }) as Detail["transaction"];

describe("Rest einer Zahlung mit offener Korrektur (#1398)", () => {
  it("bietet bei „Rechnung minus Korrektur“ die Korrektur an statt Skonto, Forderungsausfall oder Gebühr", () => {
    const angebot = restAngebot(rechnung([korrektur]), zahlung(9520));
    expect(angebot.korrektur).toEqual({ corrections: [korrektur], skonto: 0 });
    expect(angebot.restKinds).toEqual([]);
    expect(angebot.feeRest).toBe(0);
    expect(angebot.rest).toBe(2380);
  });

  it("wählt unter mehreren offenen Korrekturen die, die den Rest genau ausgleicht", () => {
    const andere = { id: "k0", number: "RE-2026-0003", open: -1000 };
    expect(restAngebot(rechnung([andere, korrektur]), zahlung(9520)).korrektur?.corrections).toEqual([korrektur]);
  });

  it("nimmt mehrere Korrekturen zusammen, wenn erst ihre Summe den Rest ausgleicht", () => {
    const halb = [
      { id: "k1", number: "RE-2026-0002", open: -1190 },
      { id: "k2", number: "RE-2026-0003", open: -1190 },
    ];
    const angebot = restAngebot(rechnung(halb), zahlung(9520));
    expect(angebot.korrektur?.corrections).toEqual(halb);
    expect(angebot.restKinds).toEqual([]);
  });

  it("bietet bei Skonto nach der Korrektur nur das Skonto auf den geminderten Betrag an, nicht den Rest samt Korrektur", () => {
    // 95,20 € nach der Korrektur, 2 % Skonto = 1,90 €, gezahlt 93,30 € in der Frist
    const frist = { days: 10, percent: 200, until: "2026-11-12", paidBy: "2026-11-12", amount: 190, payable: 9330 };
    const mitSkonto = { ...rechnung([korrektur]), skontoNachKorrektur: [frist] } as Posten;
    const angebot = restAngebot(mitSkonto, zahlung(9330));
    expect(angebot.korrektur).toMatchObject({ corrections: [korrektur], skonto: 190 });
    expect(angebot.restKinds).not.toContain("skonto");
    expect(angebot.feeRest).toBe(0);
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

  it("bietet bei einer Rechnung in Fremdwährung auch keine Kursdifferenz an", () => {
    const usd = { ...rechnung([korrektur]), currency: "USD" } as Posten;
    const angebot = restAngebot(usd, zahlung(9520));
    expect(angebot.korrektur?.corrections).toEqual([korrektur]);
    expect(angebot.exchangeDifference).toBe(0);
  });

  it("bietet bei voller Zahlung keine Korrektur an", () => {
    expect(restAngebot(rechnung([korrektur]), zahlung(11_900)).korrektur).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { korrekturenFuerRest, type OpenItem, suggestMatches, zahlungMitKorrektur } from "./matching.ts";
import { formatEuro } from "./money.ts";
import { formatPercent, skontoZahlfristen } from "./skonto.ts";

// Zahlung „Rechnung minus Korrektur“ als erster Vorschlag (#1398): Rechnung 119,00 €, Korrektur −23,80 €
const korrektur = { id: "k1", number: "2026-004", open: -2380 };
const rechnung = (openCorrections: OpenItem["openCorrections"], extra: Partial<OpenItem> = {}): OpenItem => ({
  type: "invoice",
  id: "r1",
  number: "2026-001",
  date: "2026-11-02",
  open: 11_900,
  partyName: "Testkunde",
  partyIbans: [],
  openCorrections,
  ...extra,
});
const zahlung = (amount: number, purpose = "Rechnung 2026-001", bookingDate = "2026-11-06") => ({
  bookingDate,
  amount,
  counterpartyName: "Testkunde",
  purpose,
});

describe("korrekturenFuerRest", () => {
  const a = { id: "a", number: "A", open: -1000 };
  const b = { id: "b", number: "B", open: -1380 };
  const c = { id: "c", number: "C", open: -500 };

  it("nimmt die eine Korrektur, die den Rest genau ausgleicht", () => {
    expect(korrekturenFuerRest([a, korrektur], 2380)).toEqual([korrektur]);
  });

  it("nimmt alle Korrekturen, wenn erst ihre Summe den Rest ausgleicht", () => {
    expect(korrekturenFuerRest([a, b], 2380)).toEqual([a, b]);
  });

  it("sucht keine Teilmenge: Zwei von drei Korrekturen ergeben keinen Vorschlag", () => {
    expect(korrekturenFuerRest([a, b, c], 2380)).toBeUndefined();
  });

  it("gibt ohne Rest oder ohne Korrektur nichts", () => {
    expect(korrekturenFuerRest([korrektur], 0)).toBeUndefined();
    expect(korrekturenFuerRest(undefined, 2380)).toBeUndefined();
  });
});

describe("suggestMatches mit offener Korrektur (#1398)", () => {
  it("schlägt Rechnung mit Korrektur vor, wenn die Zahlung Rechnung minus Korrektur ist", () => {
    const [best] = suggestMatches(zahlung(9520), [rechnung([korrektur])]);
    expect(best).toMatchObject({ amount: 9520, corrections: [korrektur] });
    expect(best!.skonto).toBeUndefined();
    expect(best!.reasons).toContain(`Betrag stimmt mit Korrektur 2026-004 (${formatEuro(-2380)})`);
    // Betrag 50 + Rechnungsnummer 40 + Name 15, wie bei einem exakten Betrag
    expect(best!.score).toBe(105);
  });

  it("nennt mehrere Korrekturen, wenn erst ihre Summe den Rest ausgleicht", () => {
    const zwei = [
      { id: "k1", number: "2026-004", open: -1190 },
      { id: "k2", number: "2026-005", open: -1190 },
    ];
    const [best] = suggestMatches(zahlung(9520), [rechnung(zwei)]);
    expect(best?.corrections).toEqual(zwei);
    expect(best?.reasons).toContain(`Betrag stimmt mit Korrekturen 2026-004, 2026-005 (${formatEuro(-2380)})`);
  });

  it("zählt die Nummer der Korrektur im Verwendungszweck wie die Rechnungsnummer", () => {
    const [best] = suggestMatches(zahlung(9520, "Gutschrift 2026-004 abgezogen"), [rechnung([korrektur])]);
    expect(best?.reasons).toContain("Nummer der Korrektur im Verwendungszweck");
    expect(best?.score).toBe(105);
  });

  it("rechnet Skonto vom Betrag nach der Korrektur und bucht nur dieses Skonto aus", () => {
    // 95,20 € nach der Korrektur, 2 % = 1,90 €; mit dem Skonto der Rechnung wären es 2,38 €
    const stufen = [{ days: 10, percent: 200 }];
    const item = rechnung([korrektur], {
      skonto: skontoZahlfristen(stufen, "2026-11-02", 11_900, "BY"),
      skontoNachKorrektur: skontoZahlfristen(stufen, "2026-11-02", 9520, "BY"),
    });
    const [best] = suggestMatches(zahlung(9330), [item]);
    expect(best).toMatchObject({ corrections: [korrektur], skonto: 190 });
    expect(best!.reasons).toContain(
      `Betrag stimmt mit Korrektur 2026-004 (${formatEuro(-2380)}) und ${formatPercent(200)} Skonto (${formatEuro(190)}), in der Frist`,
    );
    // Nach der Frist ist es kein Skonto mehr, und ohne Skonto passt der Rest zu keiner Korrektur
    expect(suggestMatches(zahlung(9330, "Rechnung 2026-001", "2026-11-20"), [item])[0]?.corrections).toBeUndefined();
  });

  it("bleibt beim exakten Betrag und ohne Korrektur wie bisher", () => {
    expect(suggestMatches(zahlung(11_900), [rechnung([korrektur])])[0]?.corrections).toBeUndefined();
    expect(suggestMatches(zahlung(9520), [rechnung(undefined)])[0]?.corrections).toBeUndefined();
  });

  it("erkennt bei Zahlungsausgängen keine Korrektur, auch wenn die Beträge passen würden", () => {
    // Erstattung einer Rechnung mit negativem offenen Betrag: Der Abzug einer Korrektur gilt nur für Zahlungseingänge
    const erstattung = rechnung([{ ...korrektur, open: 2380 }], { open: -11_900 });
    expect(zahlungMitKorrektur(zahlung(-9520), erstattung)).toBeUndefined();
  });
});

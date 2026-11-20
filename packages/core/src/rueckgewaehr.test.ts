import { describe, expect, it } from "vitest";
import { advanceVatSchedule, type AdvanceVatEvent } from "./anzahlung-steuer.ts";
import type { TaxShare } from "./posting.ts";

/**
 * #853: Bereits vereinnahmte Umsatzsteuer mindert sich erst mit der Rückzahlung (§ 17 UStG, UStAE 17.1 Abs. 2 Satz 3,
 * BFH V R 34/09), nur in Höhe der Überzahlung. Sie verteilt sich auf die Sätze im Verhältnis der Minderung der
 * gekennzeichneten Korrekturen je Satz (Entscheidung des Maintainers zu #1228; zuvor
 * https://github.com/Speicherstadt/haben/pull/1228#issuecomment-6940857265).
 */
const s19 = (base: number, tax: number): TaxShare => ({ rate: 1900, base, tax });
const s7 = (base: number, tax: number): TaxShare => ({ rate: 700, base, tax });
const total = [s19(100_000, 19_000)];
const held = (events: AdvanceVatEvent[], shares = total) => advanceVatSchedule(shares, events, "held");

describe("Steuer bis zur Rückzahlung", () => {
  it("bezahlt, dann 10 % Nachlass: hält 19 € bis zur Erstattung", () => {
    expect(
      held([
        { date: "2026-10-20", paid: total },
        { date: "2026-12-10", correction: [s19(-10_000, -1_900)], untilRefund: true },
        { date: "2027-01-15", paid: [s19(-10_000, -1_900)] },
      ]),
    ).toEqual([
      { date: "2026-12-10", shares: [s19(10_000, 1_900)] },
      { date: "2027-01-15", shares: [s19(-10_000, -1_900)] },
    ]);
  });

  it("unbezahlt: kein Rückzahlungsanspruch, nichts zu halten", () => {
    expect(held([{ date: "2026-12-10", correction: [s19(-10_000, -1_900)], untilRefund: true }])).toEqual([]);
  });

  it("Teilzahlung: hält nur die Überzahlung über dem geminderten Entgelt", () => {
    // 1.100 € bezahlt, Rechnung auf 1.071 € gemindert: 29 € Überzahlung, davon 4,63 € Steuer
    const paid = [s19(92_437, 17_563)];
    expect(
      held([
        { date: "2026-10-20", paid },
        { date: "2026-12-10", correction: [s19(-10_000, -1_900)], untilRefund: true },
      ]),
    ).toEqual([{ date: "2026-12-10", shares: [s19(2_437, 463)] }]);
  });

  it("ohne Kennzeichen: bisheriges Verfahren, nichts zu halten", () => {
    expect(
      held([
        { date: "2026-10-20", paid: total },
        { date: "2026-12-10", correction: [s19(-10_000, -1_900)] },
      ]),
    ).toEqual([]);
  });

  it("Aufhebung der Zahlung vor der Erstattung: nichts mehr vereinnahmt, nichts mehr zu halten", () => {
    expect(
      held([
        { date: "2026-10-20", paid: total },
        { date: "2026-12-10", correction: [s19(-10_000, -1_900)], untilRefund: true },
        { date: "2026-12-20", paid: [s19(-100_000, -19_000)] },
      ]),
    ).toEqual([
      { date: "2026-12-10", shares: [s19(10_000, 1_900)] },
      { date: "2026-12-20", shares: [s19(-10_000, -1_900)] },
    ]);
  });

  it("Kunde zahlt mehr als die Rechnung: gehalten wird höchstens die Minderung", () => {
    expect(
      held([
        { date: "2026-10-20", paid: [s19(110_000, 20_900)] },
        { date: "2026-12-10", correction: [s19(-10_000, -1_900)], untilRefund: true },
      ]),
    ).toEqual([{ date: "2026-12-10", shares: [s19(10_000, 1_900)] }]);
  });

  describe("alte Korrektur ohne Kennzeichen neben einer neuen", () => {
    const old = [s19(-10_000, -1_900)];
    const base: AdvanceVatEvent[] = [
      { date: "2026-10-20", paid: total },
      { date: "2026-11-10", correction: old, legacyClaim: { id: "alt", shares: [s19(10_000, 1_900)] } },
      { date: "2026-12-10", correction: [s19(-10_000, -1_900)], untilRefund: true },
    ];
    const refundOld: AdvanceVatEvent = { date: "2027-01-10", paid: old, legacyClaim: { id: "alt", shares: old } };
    const refundNew: AdvanceVatEvent = { date: "2027-02-10", paid: old };

    it("neue hält 19 €, Erstattung der alten mindert nicht erneut, Erstattung der neuen schon", () => {
      expect(held([...base, refundOld, refundNew])).toEqual([
        { date: "2026-12-10", shares: [s19(10_000, 1_900)] },
        { date: "2027-02-10", shares: [s19(-10_000, -1_900)] },
      ]);
    });

    it("umgekehrte Reihenfolge der Erstattungen", () => {
      expect(held([...base, { ...refundNew, date: "2027-01-10" }, { ...refundOld, date: "2027-02-10" }])).toEqual([
        { date: "2026-12-10", shares: [s19(10_000, 1_900)] },
        { date: "2027-01-10", shares: [s19(-10_000, -1_900)] },
      ]);
    });
  });

  describe("mehrere Steuersätze", () => {
    const mixed = [s19(10_000, 1_900), s7(10_000, 700)];

    it("bezahlt, Korrektur nur des 19-%-Teils: hält genau dessen Steuer", () => {
      expect(
        held(
          [
            { date: "2026-10-20", paid: mixed },
            { date: "2026-12-10", correction: [s19(-10_000, -1_900)], untilRefund: true },
          ],
          mixed,
        ),
      ).toEqual([{ date: "2026-12-10", shares: [s19(10_000, 1_900)] }]);
    });

    it("50 € bezahlt, auf 107 € gemindert: keine Überzahlung, die Minderung wirkt wie bei unbezahltem Entgelt", () => {
      expect(
        held(
          [
            { date: "2026-10-20", paid: [s19(2_213, 420), s7(2_212, 155)] },
            { date: "2026-12-10", correction: [s19(-10_000, -1_900)], untilRefund: true },
          ],
          mixed,
        ),
      ).toEqual([]);
    });

    it("150 € bezahlt, auf 107 € gemindert: 43 € Überzahlung, ganz beim geminderten Satz 19 %", () => {
      expect(
        held(
          [
            { date: "2026-10-20", paid: [s19(6_640, 1_262), s7(6_639, 459)] },
            { date: "2026-12-10", correction: [s19(-10_000, -1_900)], untilRefund: true },
          ],
          mixed,
        ),
      ).toEqual([{ date: "2026-12-10", shares: [s19(3_613, 687)] }]);
    });

    it("Korrektur über beide Sätze bei Teilüberzahlung: im Verhältnis der Minderung je Satz, Rest auf den größten Anteil", () => {
      // 219,85 € von 226 € bezahlt, 10 % Nachlass über beide Sätze: 16,45 € Überzahlung, davon 1.070/2.260 auf 7 % = 7,79 €
      // (gerundet), der Rest 8,66 € auf 19 %; je Satz Steuer im Verhältnis der Korrektur
      expect(
        held(
          [
            { date: "2026-10-20", paid: [s19(9_735, 1_850), s7(9_720, 680)] },
            { date: "2026-12-10", correction: [s19(-1_000, -190), s7(-1_000, -70)], untilRefund: true },
          ],
          mixed,
        ),
      ).toEqual([{ date: "2026-12-10", shares: [s19(728, 138), s7(728, 51)] }]);
    });
  });

  it("Plan einer Vorauszahlung: nach der Leistung gemindert, Vereinnahmtes bis zur Rückzahlung gehalten", () => {
    expect(
      advanceVatSchedule(total, [
        { date: "2026-01-10", paid: total },
        { date: "2026-01-20", performance: 1 },
        { date: "2026-02-10", correction: [s19(-10_000, -1_900)], untilRefund: true },
        { date: "2026-03-10", paid: [s19(-10_000, -1_900)] },
      ]),
    ).toEqual([
      { date: "2026-01-10", shares: total },
      { date: "2026-03-10", shares: [s19(-10_000, -1_900)] },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { computeEuer, documentEuerEffects, type EuerPayment, type EuerResult } from "./euer.ts";

const amount = (euer: EuerResult, key: string) => [...euer.einnahmen, ...euer.ausgaben].find((l) => l.key === key)?.amount ?? 0;
const totals = {
  net: 10_000,
  tax: 1_900,
  gross: 11_900,
  taxes: [{ rate: 1900, base: 10_000, tax: 1_900 }],
};
const payment = (extra: object = {}): EuerPayment => ({
  kind: "document",
  date: "2026-09-15",
  paid: 11_900,
  totals,
  category: "software",
  vorsteuerAnteil: 5_000,
  ...extra,
});

describe("EÜR: wirtschaftlich zugeordneter Teilabzug (§ 15 Abs. 4 UStG)", () => {
  it("100 € netto + 19 € Steuer, 50 % Abzug: 109,50 € Aufwand und 9,50 € Vorsteuer", () => {
    const euer = computeEuer(2026, [payment()]);
    expect(amount(euer, "ausgabe:software")).toBe(10_950);
    expect(amount(euer, "vorsteuer")).toBe(950);
    expect(euer.totalAusgaben).toBe(11_900);
    expect(euer.monthly.ausgaben[8]).toBe(10_950);
    expect(totals.tax).toBe(1_900);
  });

  it("der gespeicherte Anteil des Satzes überschreibt den Beleg, null erbt den Beleg", () => {
    const gemischt = {
      net: 20_000,
      tax: 2_600,
      gross: 22_600,
      taxes: [
        { rate: 1900, base: 10_000, tax: 1_900, vorsteuerAnteil: 2_500 },
        { rate: 700, base: 10_000, tax: 700, vorsteuerAnteil: null },
      ],
    };
    const euer = computeEuer(2026, [payment({ totals: gemischt, paid: gemischt.gross })]);
    expect(amount(euer, "vorsteuer")).toBe(475 + 350);
    expect(amount(euer, "ausgabe:software")).toBe(21_775);
    expect(euer.totalAusgaben).toBe(22_600);
  });

  it("30 % Privatanteil wird vor dem 50-%-Teilabzug getrennt", () => {
    const euer = computeEuer(2026, [payment({ privateShare: 30 })]);
    expect(amount(euer, "vorsteuer")).toBe(665);
    expect(amount(euer, "ausgabe:software")).toBe(7_665);
    expect(euer.totalAusgaben).toBe(8_330);
  });

  it("Teilzahlungen und Gutschrift verteilen nur den wirtschaftlich abziehbaren Steuerteil", () => {
    const euer = computeEuer(2026, [payment({ paid: 5_950 }), payment({ date: "2026-10-15", paid: 5_950 })]);
    expect(amount(euer, "vorsteuer")).toBe(950);
    expect(amount(euer, "ausgabe:software")).toBe(10_950);
    const gutschrift = computeEuer(2026, [payment({ paid: -11_900 })]);
    expect(amount(gutschrift, "vorsteuer")).toBe(-950);
    expect(amount(gutschrift, "ausgabe:software")).toBe(-10_950);
  });

  it("Centbeträge und negative Berichtigung werden symmetrisch gerundet", () => {
    const klein = { net: 10, tax: 3, gross: 13, taxes: [{ rate: 1900, base: 10, tax: 3 }] };
    for (const sign of [1, -1]) {
      const euer = computeEuer(2026, [payment({ totals: klein, paid: sign * 13 })]);
      expect(amount(euer, "vorsteuer")).toBe(sign * 2);
      expect(amount(euer, "ausgabe:software")).toBe(sign * 11);
    }
  });

  it("drei kleine Teilzahlungen ergeben zusammen den centgenauen Abzug des Belegs", () => {
    const klein = { net: 10, tax: 3, gross: 13, taxes: [{ rate: 1900, base: 10, tax: 3 }] };
    const euer = computeEuer(2026, [
      payment({ totals: klein, paid: 4, paidBefore: 0 }),
      payment({ totals: klein, paid: 4, paidBefore: 4 }),
      payment({ totals: klein, paid: 5, paidBefore: 8 }),
    ]);
    expect(amount(euer, "vorsteuer")).toBe(2);
    expect(amount(euer, "ausgabe:software")).toBe(11);
  });

  it("eine Rücknahme dreht den ursprünglichen Cent um; spätere Zahlungen berücksichtigen den Rundungsrest", () => {
    const klein = { net: 10, tax: 3, gross: 13, taxes: [{ rate: 1900, base: 10, tax: 3 }] };
    const beleg = payment({ totals: klein });
    if (beleg.kind !== "document") throw new Error("Beleg erwartet");
    const events = [
      { id: "eins", paid: 4, reversesId: null },
      { id: "zwei", paid: 4, reversesId: null },
      { id: "umkehr", paid: -4, reversesId: "eins" },
      { id: "drei", paid: 5, reversesId: null },
      { id: "vier", paid: 4, reversesId: null },
    ];
    const effects = documentEuerEffects(beleg, events);
    expect(effects.get("eins")!.vorsteuer).toBe(1);
    expect(effects.get("zwei")!.vorsteuer).toBe(0);
    expect(effects.get("umkehr")!.vorsteuer).toBe(-1);
    const euer = computeEuer(
      2026,
      events.map((e) => ({ ...beleg, paid: e.paid, effect: effects.get(e.id)! })),
    );
    expect(amount(euer, "vorsteuer")).toBe(2);
    expect(amount(euer, "ausgabe:software")).toBe(11);
  });

  it("Anlage: nur der abziehbare Steuerteil wird sofort Ausgabe; der Rest gehört in die Anschaffungskosten", () => {
    const euer = computeEuer(2026, [payment({ category: "anlage" })]);
    expect(amount(euer, "vorsteuer")).toBe(950);
    expect(amount(euer, "ausgabe:anlage")).toBe(0);
    expect(euer.totalAusgaben).toBe(950);
  });

  it("aufgeteilter Beleg: der nicht abziehbare Teil bleibt bei der jeweiligen Aufwandskategorie", () => {
    const euer = computeEuer(2026, [
      payment({
        splits: [
          { category: "software", taxRate: 1900, net: 6_000, tax: 1_140 },
          { category: "buero", taxRate: 1900, net: 4_000, tax: 760 },
        ],
      }),
    ]);
    expect(amount(euer, "vorsteuer")).toBe(950);
    expect(amount(euer, "ausgabe:software")).toBe(6_570);
    expect(amount(euer, "ausgabe:buero")).toBe(4_380);
  });

  it("zwei kleine Kontierungszeilen erhöhen den je Satz gerundeten Abzug nicht", () => {
    const klein = { net: 10, tax: 2, gross: 12, taxes: [{ rate: 1900, base: 10, tax: 2 }] };
    const euer = computeEuer(2026, [
      payment({
        totals: klein,
        paid: 12,
        splits: [
          { category: "software", taxRate: 1900, net: 5, tax: 1 },
          { category: "buero", taxRate: 1900, net: 5, tax: 1 },
        ],
      }),
    ]);
    expect(amount(euer, "vorsteuer")).toBe(1);
    expect(amount(euer, "ausgabe:software") + amount(euer, "ausgabe:buero")).toBe(11);
  });

  it("Bewirtung: die 70-%-Grenze betrifft auch den nicht abziehbaren Steuerteil", () => {
    const euer = computeEuer(2026, [payment({ category: "bewirtung" })]);
    expect(amount(euer, "vorsteuer")).toBe(950);
    expect(amount(euer, "ausgabe:bewirtung")).toBe(7_665);
    expect(euer.bewirtungNichtAbziehbar).toBe(3_285);
  });

  it.each([true, false])("Altbestand mit Anteil null verwendet weiterhin Boolean %s", (vorsteuerAbzug) => {
    const euer = computeEuer(2026, [payment({ vorsteuerAnteil: null, vorsteuerAbzug })]);
    expect(amount(euer, "vorsteuer")).toBe(vorsteuerAbzug ? 1_900 : 0);
    expect(amount(euer, "ausgabe:software")).toBe(vorsteuerAbzug ? 10_000 : 11_900);
  });

  it("§ 13b/Erwerb: die selbst geschuldete Steuer wirkt erst bei der Finanzamtszahlung, ohne doppelten Aufwand", () => {
    const rc = { ...totals, gross: 10_000, tax: 0, taxes: [{ rate: 1900, base: 10_000, tax: 0 }] };
    const vorZahlung = computeEuer(2026, [payment({ totals: rc, paid: 10_000, selbstGeschuldet: [1_900] })]);
    expect(amount(vorZahlung, "ausgabe:software")).toBe(10_000);
    expect(amount(vorZahlung, "vorsteuer")).toBe(0);
    const bezahlt = computeEuer(2026, [
      payment({ totals: rc, paid: 10_000, selbstGeschuldet: [1_900] }),
      { kind: "ustVorauszahlung", date: "2026-10-10", amount: -950 },
    ]);
    expect(bezahlt.totalAusgaben).toBe(10_950);
    expect(amount(bezahlt, "gezahlteUst")).toBe(950);
  });
});

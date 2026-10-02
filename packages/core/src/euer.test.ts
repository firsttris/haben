import { describe, expect, it } from "vitest";
import { computeEuer, euerToCsv, type EuerPayment } from "./euer.ts";
import { computeInvoiceTotals } from "./invoice.ts";

const amount = (euer: ReturnType<typeof computeEuer>, key: string) =>
  [...euer.einnahmen, ...euer.ausgaben].find((l) => l.key === key)?.amount ?? 0;

const invoice19 = computeInvoiceTotals([{ quantity: 1000, unitPrice: 400_000, taxRate: 1900 }]);
const mixed = computeInvoiceTotals([
  { quantity: 1000, unitPrice: 100_000, taxRate: 1900 },
  { quantity: 1000, unitPrice: 10_000, taxRate: 700 },
  { quantity: 1000, unitPrice: 5_000, taxRate: 0 },
]);
const telefon = { net: 3857, tax: 733, gross: 4590, taxes: [{ rate: 1900, base: 3857, tax: 733 }] };

describe("computeEuer", () => {
  it("teilt Zahlungseingänge in Netto und Umsatzsteuer", () => {
    const euer = computeEuer(2026, [{ kind: "invoice", date: "2026-10-01", paid: 476_000, totals: invoice19 }]);
    expect(amount(euer, "einnahmenSteuerpflichtig")).toBe(400_000);
    expect(amount(euer, "vereinnahmteUst")).toBe(76_000);
    expect(euer.totalEinnahmen).toBe(476_000);
    expect(euer.gewinn).toBe(476_000);
    expect(euer.monthly.einnahmen[9]).toBe(400_000);
  });

  it("steuerfreie Anteile gehen in eine eigene Zeile", () => {
    const euer = computeEuer(2026, [{ kind: "invoice", date: "2026-03-01", paid: mixed.gross, totals: mixed }]);
    expect(amount(euer, "einnahmenSteuerpflichtig")).toBe(110_000);
    expect(amount(euer, "einnahmenSteuerfrei")).toBe(5_000);
    expect(amount(euer, "vereinnahmteUst")).toBe(19_700);
    expect(euer.totalEinnahmen).toBe(mixed.gross);
  });

  it("Teilzahlungen werden anteilig aufgeteilt und ergeben zusammen die Rechnung", () => {
    const euer = computeEuer(2026, [
      { kind: "invoice", date: "2026-10-01", paid: 200_000, totals: invoice19 },
      { kind: "invoice", date: "2026-11-01", paid: 276_000, totals: invoice19 },
    ]);
    expect(amount(euer, "vereinnahmteUst")).toBe(76_000);
    expect(amount(euer, "einnahmenSteuerpflichtig")).toBe(400_000);
    expect(euer.monthly.einnahmen[9]).toBe(168_067);
    expect(euer.monthly.einnahmen[10]).toBe(231_933);
  });

  it("aufgehobene Zuordnungen heben sich exakt auf", () => {
    const odd = computeInvoiceTotals([{ quantity: 1000, unitPrice: 333, taxRate: 1900 }]);
    const payments: EuerPayment[] = [
      { kind: "invoice", date: "2026-05-02", paid: 199, totals: odd, group: "tx1" },
      { kind: "invoice", date: "2026-05-02", paid: -199, totals: odd, group: "tx1" },
      { kind: "ustVorauszahlung", date: "2026-05-10", amount: -50_000, group: "tx2" },
      { kind: "ustVorauszahlung", date: "2026-05-10", amount: 50_000, group: "tx2" },
    ];
    const euer = computeEuer(2026, payments);
    expect(euer.totalEinnahmen).toBe(0);
    expect(euer.totalAusgaben).toBe(0);
  });

  it("Korrekturen und Gutschriften mindern", () => {
    const korrektur = computeInvoiceTotals([{ quantity: 1000, unitPrice: -10_000, taxRate: 1900 }]);
    const gutschrift = { net: -1000, tax: -190, gross: -1190, taxes: [{ rate: 1900, base: -1000, tax: -190 }] };
    const euer = computeEuer(2026, [
      { kind: "invoice", date: "2026-06-01", paid: -11_900, totals: korrektur },
      { kind: "document", date: "2026-06-03", paid: -1190, totals: gutschrift, category: "software" },
    ]);
    expect(amount(euer, "einnahmenSteuerpflichtig")).toBe(-10_000);
    expect(amount(euer, "vereinnahmteUst")).toBe(-1_900);
    expect(amount(euer, "ausgabe:software")).toBe(-1000);
    expect(amount(euer, "vorsteuer")).toBe(-190);
  });

  it("Belege: Aufwand je Kategorie, Vorsteuer, Bankgebühren und USt-Zahlungen", () => {
    const euer = computeEuer(2026, [
      { kind: "document", date: "2026-09-29", paid: 4590, totals: telefon, category: "telefon" },
      { kind: "document", date: "2026-02-10", paid: 2000, totals: telefon, category: "telefon" },
      { kind: "gebuehren", date: "2026-09-30", amount: -990 },
      { kind: "ustVorauszahlung", date: "2026-09-10", amount: -120_000 },
      { kind: "ustVorauszahlung", date: "2026-04-10", amount: 3_000 },
    ]);
    expect(amount(euer, "ausgabe:telefon")).toBe(3857 + 1681);
    expect(amount(euer, "vorsteuer")).toBe(733 + 319);
    expect(amount(euer, "ausgabe:geldverkehr")).toBe(990);
    expect(amount(euer, "gezahlteUst")).toBe(120_000);
    expect(amount(euer, "erstatteteUst")).toBe(3_000);
    expect(euer.totalAusgaben).toBe(4590 + 2000 + 990 + 120_000);
    expect(euer.gewinn).toBe(3_000 - euer.totalAusgaben);
    expect(euer.monthly.ausgaben[8]).toBe(3857 + 990);
    expect(euer.ausgaben.map((l) => l.key)).toEqual(["ausgabe:telefon", "ausgabe:geldverkehr", "vorsteuer", "gezahlteUst"]);
  });

  it("zählt nur Zahlungen im Jahr (Zufluss/Abfluss), privat bezahlte Belege nach Belegdatum", () => {
    const payments: EuerPayment[] = [
      { kind: "invoice", date: "2025-12-31", paid: 476_000, totals: invoice19 },
      { kind: "invoice", date: "2027-01-01", paid: 476_000, totals: invoice19 },
      { kind: "document", date: "2026-01-01", paid: 4590, totals: telefon, category: "hardware" },
      { kind: "document", date: "2026-12-31", paid: 4590, totals: telefon, category: "buero" },
    ];
    const euer = computeEuer(2026, payments);
    expect(euer.totalEinnahmen).toBe(0);
    expect(euer.totalAusgaben).toBe(9180);
    expect(euer.ausgaben[0]).toMatchObject({ key: "ausgabe:hardware", note: expect.stringContaining("geringwertige") });
    expect(euer.monthly.ausgaben[0]).toBe(3857);
    expect(euer.monthly.ausgaben[11]).toBe(3857);
    expect(computeEuer(2025, payments).totalEinnahmen).toBe(476_000);
  });

  it("CSV mit Semikolon und Dezimalkomma", () => {
    const csv = euerToCsv(computeEuer(2026, [{ kind: "invoice", date: "2026-10-01", paid: 476_000, totals: invoice19 }]));
    expect(csv.startsWith("﻿Bereich;Position;Betrag (EUR)\r\n")).toBe(true);
    expect(csv).toContain("Betriebseinnahmen;Umsatzsteuerpflichtige Betriebseinnahmen (netto);4.000,00\r\n");
    expect(csv).toContain("Ergebnis;Gewinn;4.760,00\r\n");
  });
});

import { describe, expect, it } from "vitest";
import { computeEuer, euerToCsv, type EuerPayment } from "./euer.ts";
import { computeInvoiceTotals } from "./invoice.ts";

const amount = (euer: ReturnType<typeof computeEuer>, key: string) => [...euer.einnahmen, ...euer.ausgaben].find((l) => l.key === key)?.amount ?? 0;

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

  it("Kleinunternehmer: eigene Einnahmenzeile, Steuer auf Belegen ist Ausgabe", () => {
    const ku = computeInvoiceTotals([{ quantity: 1000, unitPrice: 100_000, taxRate: 0 }]);
    const euer = computeEuer(2026, [
      { kind: "invoice", date: "2026-03-01", paid: ku.gross, totals: ku, treatment: "kleinunternehmer" },
      { kind: "document", date: "2026-03-02", paid: telefon.gross, totals: telefon, category: "telefon", vorsteuerAbzug: false },
    ]);
    expect(amount(euer, "einnahmenKleinunternehmer")).toBe(100_000);
    expect(amount(euer, "einnahmenSteuerfrei")).toBe(0);
    expect(amount(euer, "ausgabe:telefon")).toBe(4590);
    expect(amount(euer, "vorsteuer")).toBe(0);
    expect(euer.gewinn).toBe(100_000 - 4590);
  });

  it("Bewirtung: 70 % Ausgabe, 30 % nicht abziehbar, Vorsteuer voll; Geschenke voll", () => {
    const essen = computeInvoiceTotals([{ quantity: 1000, unitPrice: 10_000, taxRate: 1900 }]);
    const euer = computeEuer(2026, [
      { kind: "document", date: "2026-03-02", paid: essen.gross, totals: essen, category: "bewirtung" },
      { kind: "document", date: "2026-03-03", paid: telefon.gross, totals: telefon, category: "geschenke" },
    ]);
    expect(amount(euer, "ausgabe:bewirtung")).toBe(7_000);
    expect(euer.bewirtungNichtAbziehbar).toBe(3_000);
    expect(amount(euer, "ausgabe:geschenke")).toBe(3857);
    expect(amount(euer, "vorsteuer")).toBe(1_900 + 733);
    expect(euer.gewinn).toBe(-(7_000 + 1_900 + telefon.gross));
    expect(euer.monthly.ausgaben[2]).toBe(7_000 + 3857);
    expect(euerToCsv(euer)).toContain("Nicht abziehbare Bewirtungsaufwendungen (30 %);30,00");
    // Ohne Vorsteuerabzug zählt die Steuer zur Ausgabe und wird mit aufgeteilt
    const ku = computeEuer(2026, [{ kind: "document", date: "2026-03-02", paid: essen.gross, totals: essen, category: "bewirtung", vorsteuerAbzug: false }]);
    expect(amount(ku, "ausgabe:bewirtung")).toBe(8_330);
    expect(ku.bewirtungNichtAbziehbar).toBe(3_570);
  });

  it("Anlagekauf: nur die Vorsteuer ist Ausgabe, abgeschrieben wird über die AfA", () => {
    const auto = computeInvoiceTotals([{ quantity: 1000, unitPrice: 3_000_000, taxRate: 1900 }]);
    const euer = computeEuer(2026, [{ kind: "document", date: "2026-03-10", paid: auto.gross, totals: auto, category: "anlage" }], {
      afa: 416_667,
      gwg: 0,
      sammelposten: 0,
      restbuchwert: 0,
    });
    expect(amount(euer, "vorsteuer")).toBe(570_000);
    expect(amount(euer, "ausgabe:anlage")).toBe(0);
    expect(amount(euer, "afa")).toBe(416_667);
    expect(euer.ausgaben.map((l) => l.key)).not.toContain("gwg");
    expect(euer.totalAusgaben).toBe(570_000 + 416_667);
  });

  it("Privatanteil am Beleg und private Kfz-Nutzung", () => {
    const euer = computeEuer(
      2026,
      [{ kind: "document", date: "2026-03-02", paid: telefon.gross, totals: telefon, category: "telefon", privateShare: 20 }],
      undefined,
      { privateKfz: 176_700, ustEntnahmen: 107_436 },
    );
    expect(amount(euer, "ausgabe:telefon")).toBe(3_086);
    expect(amount(euer, "vorsteuer")).toBe(586);
    expect(amount(euer, "privateKfz")).toBe(176_700);
    expect(amount(euer, "ustEntnahmen")).toBe(107_436);
    expect(euer.totalEinnahmen).toBe(176_700 + 107_436);
  });

  it("§ 13b mit Privatanteil: der private Teil der selbst geschuldeten Steuer zählt anteilig zur Zahlung in Zeile 17", () => {
    // Netto 1.000 €, gezahlt wird nur netto; Steuer 190 €, davon 30 % privat
    const rc = { net: 100_000, tax: 0, gross: 100_000, taxes: [{ rate: 1900, base: 100_000, tax: 0 }] };
    const beleg = { kind: "document", totals: rc, category: "edv", privateShare: 30, selbstGeschuldet: [19_000] } as const;
    const teil = computeEuer(2026, [{ ...beleg, date: "2026-03-02", paid: 40_000 }]);
    expect(amount(teil, "vereinnahmteUst")).toBe(2_280);
    const ganz = computeEuer(2026, [
      { ...beleg, date: "2026-03-02", paid: 40_000 },
      { ...beleg, date: "2026-04-02", paid: 60_000 },
    ]);
    expect(amount(ganz, "vereinnahmteUst")).toBe(5_700);
    expect(amount(ganz, "ausgabe:edv")).toBe(70_000);
    // Storno (negativ) nimmt den Betrag wieder heraus
    expect(amount(computeEuer(2026, [{ ...beleg, date: "2026-05-02", paid: -100_000 }]), "vereinnahmteUst")).toBe(-5_700);
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

  it("Lohn: Auszahlung, Lohnsteuer und SV-Beiträge sind Ausgaben für Personal, wenn sie abfließen (§ 11 Abs. 2 EStG)", () => {
    // Abrechnung Oktober 2026 (lohn-buchung.test.ts): 2.640,17 € Auszahlung am 30.10., 539,83 € Lohnsteuer am 10.11.,
    // 1.757,60 € SV-Beiträge am 28.10.; die Dezemberbeiträge erst im Januar. Eine Rückzahlung mindert die Ausgabe.
    const payments: EuerPayment[] = [
      { kind: "lohn", date: "2026-10-30", amount: -2640_17 },
      { kind: "lohn", date: "2026-11-10", amount: -539_83 },
      { kind: "lohn", date: "2026-10-28", amount: -1757_60 },
      { kind: "lohn", date: "2026-11-12", amount: 10_00 },
      { kind: "lohn", date: "2027-01-08", amount: -539_83 },
    ];
    const euer = computeEuer(2026, payments);
    expect(amount(euer, "personal")).toBe(2640_17 + 539_83 + 1757_60 - 10_00);
    expect(euer.ausgaben.find((l) => l.key === "personal")?.label).toBe("Löhne und Gehälter einschließlich Lohnsteuer und Sozialversicherung");
    expect(euer.totalAusgaben).toBe(4927_60);
    expect(euer.monthly.ausgaben[9]).toBe(2640_17 + 1757_60);
    expect(euer.monthly.ausgaben[10]).toBe(539_83 - 10_00);
    expect(amount(computeEuer(2027, payments), "personal")).toBe(539_83);
    // Ohne Lohn keine Zeile
    expect(computeEuer(2026, []).ausgaben.some((l) => l.key === "personal")).toBe(false);
  });

  it("CSV mit Semikolon und Dezimalkomma", () => {
    const csv = euerToCsv(computeEuer(2026, [{ kind: "invoice", date: "2026-10-01", paid: 476_000, totals: invoice19 }]));
    expect(csv.startsWith("﻿Bereich;Position;Betrag (EUR)\r\n")).toBe(true);
    expect(csv).toContain("Betriebseinnahmen;Umsatzsteuerpflichtige Betriebseinnahmen (netto);4000,00\r\n");
    expect(csv).toContain("Ergebnis;Gewinn;4760,00\r\n");
  });
});

describe("computeEuer mit Pauschalen", () => {
  it("zählt Pauschalen je Art als Ausgabe, Stornos heben sie auf", () => {
    const euer = computeEuer(2025, [
      { kind: "pauschale", date: "2025-03-31", amount: 9_600, art: "homeoffice" },
      { kind: "pauschale", date: "2025-04-02", amount: 3_720, art: "fahrt" },
      { kind: "pauschale", date: "2025-04-02", amount: 1_400, art: "verpflegung" },
      { kind: "pauschale", date: "2025-04-03", amount: -1_400, art: "verpflegung" },
      { kind: "pauschale", date: "2024-12-31", amount: 600, art: "homeoffice" },
    ]);
    const ausgabe = (key: string) => euer.ausgaben.find((l) => l.key === key)?.amount;
    expect(ausgabe("pauschale:homeoffice")).toBe(9_600);
    expect(ausgabe("pauschale:fahrt")).toBe(3_720);
    expect(ausgabe("pauschale:verpflegung")).toBeUndefined();
    expect(euer.totalAusgaben).toBe(13_320);
    expect(euer.gewinn).toBe(-13_320);
    expect(euer.monthly.ausgaben[3]).toBe(3_720);
  });
});

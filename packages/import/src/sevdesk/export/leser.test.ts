import { describe, expect, it } from "vitest";
import { readSevdeskExport } from "./leser.ts";
import { fixture, innerZip, pdfBytes, unmaskedStack10, zip } from "./testzip.ts";
import type { SevExport } from "./types.ts";

/*
 * Export „Buchungsdaten & Belegbilder“ beider Buchhaltungsversionen, nachgebaut aus den Testdaten
 * (packages/import/test-fixtures/sevdesk/README.md): Stapel und Stammdaten in der äußeren ZIP,
 * je Richtung eine innere ZIP mit document.xml und den Belegdateien.
 */

const ZEITRAUM = "20240101_20241231";

function read(entries: Parameters<typeof zip>[0]): SevExport {
  const result = readSevdeskExport(zip(entries), { kontenrahmen: "SKR03" });
  if (!result.ok) throw new Error(result.reason);
  return result.export;
}

const byGuid = (data: SevExport, guid: string) => data.vouchers.find((v) => v.guid === guid);
const guid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

describe("Export aus Buchhaltungsversion 1.0", () => {
  const gp = fixture("buchhaltung-1.0/extf-gp-stamm.csv");
  const data = read({
    [`EXTF_Buchungsstapel_${ZEITRAUM}.csv`]: unmaskedStack10(),
    [`EXTF_GP_Stamm_${ZEITRAUM}.csv`]: gp,
    [`DATEV_Rechnungsausgang_${ZEITRAUM}.zip`]: innerZip(fixture("buchhaltung-1.0/document-rechnungsausgang.xml")),
    [`DATEV_Rechnungseingang_${ZEITRAUM}.zip`]: innerZip(fixture("buchhaltung-1.0/document-rechnungseingang.xml")),
  });

  it("liest den Stapel und gibt die Stammdaten ungelesen zurück", () => {
    expect(data.stacks).toHaveLength(1);
    expect(data.stacks[0]!.stack.bookings).toHaveLength(7);
    expect(data.stacks[0]!.bytes).toEqual(unmaskedStack10());
    expect(data.partnerFiles).toEqual([{ name: `EXTF_GP_Stamm_${ZEITRAUM}.csv`, bytes: gp }]);
  });

  it("bildet je GUID einen Beleg; Zahlung, Privatentnahme und Abschreibung werden keine", () => {
    expect(data.vouchers.map((v) => v.guid)).toEqual([guid(1), guid(2), guid(3), guid(4)]);
  });

  it("Ausgangsrechnung: Richtung aus document.xml, Beträge in Cent und Basispunkten, Datei nach GUID", () => {
    const rechnung = byGuid(data, guid(1))!;
    expect(rechnung).toMatchObject({
      key: guid(1),
      number: "XX-1111-11-1111",
      date: "2024-01-15",
      direction: "ausgang",
      directionFrom: "document",
      accountKind: "erloese",
      currency: "EUR",
      amount: 10000,
      net: 10000,
      tax: 10000,
      rate: 1900,
    });
    expect(rechnung.lines.map((l) => l.booking.row)).toEqual([3]);
    expect(rechnung.lines[0]!.info.entries).toMatchObject({ Nettobetrag: "100,00", Umsatzsteuerprozent: "19", Leistungsdatum: "15.01.2024" });
    const name = "2024-01-15_Rechnung_XX-1111-11-1111_00000000000000000000000000000000.pdf";
    expect(rechnung.document).toMatchObject({ guid: guid(1), direction: "ausgang", fileName: name, archive: `DATEV_Rechnungsausgang_${ZEITRAUM}.zip` });
    expect(rechnung.document!.element).toMatchObject({ guid: guid(1), type: "2" });
    expect(data.files.get(guid(1))).toEqual({ fileName: name, bytes: pdfBytes(name) });
  });

  it("Ausgabebeleg im Rechnungseingang und Einnahmebeleg mit Debitor im Soll", () => {
    expect(byGuid(data, guid(3))).toMatchObject({ direction: "eingang", accountKind: "aufwand", amount: 10000 });
    expect(byGuid(data, guid(4))).toMatchObject({ direction: "ausgang", accountKind: "erloese", amount: 10000 });
    expect(data.files.size).toBe(4);
  });

  it("meldet die Zeile in US-Dollar, ohne umzurechnen", () => {
    expect(byGuid(data, guid(2))).toMatchObject({ currency: "USD", amount: 10000 });
    expect(data.hints).toContain(`EXTF_Buchungsstapel_${ZEITRAUM}.csv, Zeile 4: Umsatz in USD, nicht in Euro umgerechnet.`);
  });

  it("meldet maskierte Beleginfo, die nicht zum Umsatz passt", () => {
    expect(data.hints).toContain(`EXTF_Buchungsstapel_${ZEITRAUM}.csv, Zeile 3: Netto 100,00 und Steuer 100,00 aus Beleginfo ergeben nicht den Umsatz 100,00.`);
  });
});

describe("Export aus Buchhaltungsversion 2.0", () => {
  const data = read({
    [`EXTF_Buchungsstapel_${ZEITRAUM}.csv`]: fixture("buchhaltung-2.0/extf-buchungsstapel-auszug.csv"),
    [`EXTF_GP_Stamm_${ZEITRAUM}.csv`]: fixture("buchhaltung-2.0/extf-gp-stamm.csv"),
    [`DATEV_Rechnungsausgang_${ZEITRAUM}.zip`]: innerZip(fixture("buchhaltung-2.0/document-rechnungsausgang.xml")),
    [`DATEV_Rechnungseingang_${ZEITRAUM}.zip`]: innerZip(fixture("buchhaltung-2.0/document-rechnungseingang.xml")),
  });

  it("Rechnung und Ausgabebeleg mit Netto und Steuer aus Beleginfo", () => {
    expect(byGuid(data, guid(1))).toMatchObject({ direction: "ausgang", amount: 10000, net: 8403, tax: 1597, rate: 1900, number: "XX-1111111111" });
    expect(byGuid(data, guid(2))).toMatchObject({ direction: "eingang", directionFrom: "document", amount: 10000, net: 8403, tax: 1597 });
  });

  it("Gutschrift: S auf 8400 mindert die Erlöse", () => {
    expect(byGuid(data, guid(3))).toMatchObject({ direction: "ausgang", accountKind: "erloese", amount: -10000, net: null, tax: null, rate: 1900 });
  });

  it("die Zahlung wird kein Beleg", () => {
    expect(data.vouchers).toHaveLength(3);
  });

  it("meldet Dateien ohne Buchung", () => {
    for (const n of [4, 5, 6]) expect(data.hints).toContainEqual(expect.stringContaining(`GUID ${guid(n)}`));
    expect(data.files.size).toBe(6);
    expect(data.hints.filter((h) => h.includes("ohne Buchung"))).toHaveLength(3);
  });
});

describe("Gutschriften aus Version 2.0 (Honorar und Provision)", () => {
  const data = read({
    "EXTF_Buchungsstapel_20261001_20261130.csv": fixture("buchhaltung-2.0/extf-buchungsstapel-gutschriften.csv"),
    "DATEV_Rechnungsausgang_20261001_20261130.zip": innerZip(fixture("buchhaltung-2.0/document-rechnungsausgang-gutschriften.xml")),
  });
  const gutschrift = (n: number) => `00000000-0000-0000-0000-00000000000${n}`;

  it("liegen im Rechnungsausgang, sind aber auf Aufwand mit Vorsteuer gebucht", () => {
    for (const [n, konto] of [
      [1, "4760"],
      [2, "3100"],
    ] as const) {
      expect(byGuid(data, gutschrift(n))).toMatchObject({
        date: "2026-11-12",
        direction: "ausgang",
        accountKind: "aufwand",
        amount: 119,
        net: 100,
        tax: 19,
        rate: 1900,
      });
      expect(data.hints).toContainEqual(expect.stringContaining(`Rechnungsausgang, gebucht auf Aufwandskonto ${konto}`));
    }
  });
});

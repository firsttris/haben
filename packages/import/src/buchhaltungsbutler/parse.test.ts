import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { previewBuchhaltungsbutlerExport } from "./parse.ts";
import { readExportFiles } from "./export-files.ts";
import type { ExportPart } from "./export-files.ts";

const BB_HEADERS = [
  "Datum",
  "Buchungstext",
  "Betrag",
  "Währung",
  "Sollkonto",
  "Habenkonto",
  "Steuerschlüssel",
  "Buchungsnummer",
  "Rechnungsnummern",
  "Gegenpartei",
  "Umsatzsteuer",
  "Zugewiesene Beträge",
  "Beleglinks",
  "Festschreibung",
  "Kommentar",
  "Leistungsdatum",
] as const;

const DATEV_HEADERS = [
  "Umsatz (ohne Soll/Haben-Kz)",
  "Soll/Haben-Kennzeichen",
  "WKZ Umsatz",
  "Konto",
  "Gegenkonto (ohne BU-Schlüssel)",
  "BU-Schlüssel",
  "Belegdatum",
  "Belegfeld 1",
  "Buchungstext",
  ...Array.from({ length: 16 }, (_, i) => `Beleginfo - ${i % 2 === 0 ? "Art" : "Inhalt"} ${Math.floor(i / 2) + 1}`),
] as const;

interface TestRow {
  id: string;
  amount?: string;
  debit: string;
  credit: string;
  side?: "S" | "H";
  bu?: string;
  number?: string;
  contact?: string;
  documentDate?: string;
  rate?: string;
}

function csv(rows: (readonly string[])[]): Uint8Array {
  const text = rows.map((row) => row.map((field) => `"${field.replaceAll('"', '""')}"`).join(";")).join("\r\n");
  return new TextEncoder().encode(text);
}

function makeParts(rows: TestRow[], pdfIds = rows.filter((row) => row.number).map((row) => row.id)): ExportPart[] {
  const datevRows: string[][] = [meta(), [...DATEV_HEADERS]];
  const bbRows: string[][] = [[...BB_HEADERS]];
  const receipts: Record<string, Uint8Array> = {};
  for (const row of rows) {
    const amount = row.amount ?? "119,00";
    const rate = row.rate ?? "19";
    const documentDate = row.documentDate ?? "02.01.2023";
    const contact = row.contact ?? "Muster GmbH";
    const side = row.side ?? "H";
    const account = side === "S" ? row.debit : row.credit;
    const contra = side === "S" ? row.credit : row.debit;
    const info: string[] = [];
    const addInfo = (name: string, value: string) => info.push(name, value);
    addInfo("Buchungsnummer", row.id);
    if (row.number) {
      addInfo("URL", `https://bb.example/${row.number}.pdf`);
      addInfo("Gegenpartei", contact);
      addInfo("Rechnungsnummer", row.number);
      addInfo("Betrag", amount);
      addInfo("Umsatzsteuer", rate);
      addInfo("Rechnungsdatum", documentDate);
    }
    datevRows.push([amount, side, "EUR", account, contra, row.bu ?? "9", "0401", row.number ?? "", contact, ...info]);
    bbRows.push([
      "04.01.2023",
      contact,
      amount,
      "EUR",
      row.debit,
      row.credit,
      row.bu ?? "9",
      row.id,
      row.number ?? "",
      contact,
      rate,
      amount,
      row.number ? `https://bb.example/${row.number}.pdf` : "",
      "1",
      "",
      documentDate,
    ]);
    if (pdfIds.includes(row.id)) receipts[`Belege/${row.id}.pdf`] = new TextEncoder().encode("%PDF-1.4\n%%EOF");
  }
  return [
    { name: "EXTF_Buchungsstapel.csv", bytes: csv(datevRows) },
    { name: "BB_Buchungsstapel.csv", bytes: csv(bbRows) },
    { name: "Belege.zip", bytes: zipSync(receipts) },
  ];
}

function meta(): string[] {
  const fields = Array.from({ length: 30 }, () => "");
  fields[0] = "EXTF";
  fields[1] = "700";
  fields[2] = "21";
  fields[3] = "Buchungsstapel";
  fields[4] = "12";
  fields[12] = "20230101";
  fields[13] = "4";
  fields[14] = "20230101";
  fields[15] = "20231231";
  fields[21] = "EUR";
  fields[26] = "03";
  return fields;
}

describe("BuchhaltungsButler-Export", () => {
  it("mappt eine Ausgabe mit Rechnungsdatum und PDF", () => {
    const result = previewBuchhaltungsbutlerExport(makeParts([{ id: "127", number: "202300327", debit: "4964", credit: "1203", amount: "67,79" }]), "SKR03");
    expect(result.bookings).toBe(1);
    expect(result.files).toBe(1);
    expect(result.vouchers[0]).toMatchObject({
      bookingId: "127",
      voucher: {
        lexofficeId: "booking/2023/127",
        type: "purchaseinvoice",
        direction: "ausgabe",
        number: "202300327",
        date: "2023-01-02",
        net: 5697,
        tax: 1082,
        gross: 6779,
        taxes: [{ rate: 1900, net: 5697, tax: 1082 }],
      },
    });
    expect(result.vouchers[0]?.files[0]?.filename).toBe("127.pdf");
  });

  it("mappt Gutschrift, Anlagekauf und Geldtransit", () => {
    const result = previewBuchhaltungsbutlerExport(
      makeParts([
        { id: "1", number: "G-1", debit: "8400", credit: "1203", side: "S", bu: "3" },
        { id: "2", number: "A-1", debit: "0420", credit: "1204" },
        { id: "3", number: "E-1", debit: "1204", credit: "1360" },
      ]),
      "SKR03",
    );
    expect(result.vouchers.map((item) => [item.voucher.type, item.voucher.gross])).toEqual([
      ["creditnote", -11900],
      ["purchaseinvoice", 11900],
      ["invoice", 11900],
    ]);
  });

  it("mappt Einnahmen und Ausgaben auch mit SKR04", () => {
    const result = previewBuchhaltungsbutlerExport(
      makeParts([
        { id: "1", number: "G-1", debit: "4400", credit: "1203", side: "S", bu: "3" },
        { id: "2", number: "A-1", debit: "5400", credit: "1203" },
      ]),
      "SKR04",
    );
    expect(result.vouchers.map((item) => item.voucher.type)).toEqual(["creditnote", "purchaseinvoice"]);
  });

  it("lässt Buchungen ohne Beleg aus und liest mehrere PDFs", () => {
    const parts = makeParts([
      { id: "97", number: "R-97", debit: "4964", credit: "1203" },
      { id: "98", debit: "1203", credit: "8400", side: "S", bu: "0" },
    ]);
    parts[2] = {
      name: "Belege.zip",
      bytes: zipSync({
        "Belege/97_1.pdf": new TextEncoder().encode("%PDF-1.4\n1"),
        "Belege/97_2.pdf": new TextEncoder().encode("%PDF-1.4\n2"),
      }),
    };
    const result = previewBuchhaltungsbutlerExport(parts, "SKR03");
    expect(result.bookings).toBe(2);
    expect(result.vouchers).toHaveLength(1);
    expect(result.files).toBe(2);
    expect(result.withoutReceipt).toBe(1);
    expect(result.multipleFiles).toBe(1);
  });

  it("liest das äußere datenexport.zip", () => {
    const parts = makeParts([{ id: "127", number: "R-127", debit: "4964", credit: "1203" }]);
    const outer = zipSync(Object.fromEntries(parts.map((part) => [part.name, part.bytes])));
    const files = readExportFiles([{ name: "datenexport.zip", bytes: outer }]);
    expect(new TextDecoder().decode(files.datev)).toContain("EXTF");
    expect(new TextDecoder().decode(files.bb)).toContain("Buchungsnummer");
  });

  it("bricht bei Abweichungen zwischen BB und DATEV ab", () => {
    const parts = makeParts([{ id: "127", number: "R-127", debit: "4964", credit: "1203" }]);
    const rows = [
      BB_HEADERS,
      ["04.01.2023", "Muster", "68,00", "EUR", "4964", "1203", "9", "127", "R-127", "Muster", "19", "68,00", "url", "1", "", "02.01.2023"],
    ];
    parts[1] = { name: "BB_Buchungsstapel.csv", bytes: csv(rows) };
    expect(() => previewBuchhaltungsbutlerExport(parts, "SKR03")).toThrow("weichen ab");
  });

  it("bricht bei fehlendem PDF ab", () => {
    const parts = makeParts([{ id: "127", number: "R-127", debit: "4964", credit: "1203" }], []);
    expect(() => previewBuchhaltungsbutlerExport(parts, "SKR03")).toThrow("PDF fehlt");
  });

  it("bricht bei unklarer Kontenrichtung ab", () => {
    const parts = makeParts([{ id: "127", number: "R-127", debit: "2000", credit: "2001" }]);
    expect(() => previewBuchhaltungsbutlerExport(parts, "SKR03")).toThrow("nicht eindeutig");
  });
});

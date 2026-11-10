import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { previewBuchhaltungsbutlerExport } from "./parse.ts";
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

describe("BuchhaltungsButler-Export: Steuersatz aus dem BU-Schlüssel", () => {
  it("rechnet 19 % aus BU-Schlüssel 3 bei einem Erlös ohne Beleg und ohne Steuersatz-Text", () => {
    const result = previewBuchhaltungsbutlerExport(makeParts([{ id: "1", debit: "1200", credit: "8400", bu: "3", rate: "" }]), "SKR03");
    expect(result.vouchers[0]!.voucher).toMatchObject({ net: 10000, tax: 1900, gross: 11900, taxes: [{ rate: 1900, net: 10000, tax: 1900 }] });
  });

  it("rechnet 19 % aus BU-Schlüssel 9 bei einer Ausgabe mit Beleg ohne Steuersatz-Text", () => {
    const result = previewBuchhaltungsbutlerExport(makeParts([{ id: "1", number: "R-1", debit: "4964", credit: "1200", bu: "9", rate: "" }]), "SKR03");
    expect(result.vouchers[0]!.voucher).toMatchObject({ net: 10000, tax: 1900, gross: 11900, taxes: [{ rate: 1900, net: 10000, tax: 1900 }] });
  });
});

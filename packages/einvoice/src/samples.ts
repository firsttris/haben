import { computeInvoiceTotals, lineNet, type InvoiceLineInput } from "@haben/core";
import type { Buyer, InvoiceDocument, InvoiceFormat, InvoiceKind, Seller } from "./types.ts";

// Beispielbelege für Tests und KoSIT-Prüfung

export const sampleSeller: Seller = {
  name: "Erika Mustermann",
  strasse: "Lindenstraße 12",
  plz: "10969",
  ort: "Berlin",
  land: "DE",
  email: "rechnung@mustermann.example",
  telefon: "+49 30 1234567",
  steuernummer: "13/345/67890",
  ustId: "DE123456789",
  iban: "DE89370400440532013000",
  bic: "COBADEFFXXX",
  bank: "Commerzbank",
};

export const sampleBuyer: Buyer = {
  name: "Beispiel GmbH",
  strasse: "Hafenweg 3",
  plz: "20457",
  ort: "Hamburg",
  land: "DE",
  email: "buchhaltung@beispiel.example",
  kundennummer: "K-1007",
};

export const publicBuyer: Buyer = {
  name: "Bezirksamt Musterstadt",
  strasse: "Rathausplatz 1",
  plz: "12345",
  ort: "Musterstadt",
  land: "DE",
  leitwegId: "991-12345-67",
};

interface SampleOptions {
  kind?: InvoiceKind;
  format?: InvoiceFormat;
  number?: string;
  buyer?: Buyer;
  lines?: InvoiceLineInput[];
  note?: string;
}

export function sampleDocument(options: SampleOptions = {}): InvoiceDocument {
  const kind = options.kind ?? "rechnung";
  const sign = kind === "rechnung" ? 1 : -1;
  const inputs = (
    options.lines ?? [
      { description: "Softwareentwicklung September", quantity: 152000, unit: "Std.", unitPrice: 9500, taxRate: 1900 },
      { description: "Reisekosten Hamburg", quantity: 1000, unit: "Psch.", unitPrice: 18990, taxRate: 1900 },
    ]
  ).map((line) => ({ ...line, unitPrice: sign * line.unitPrice }));
  return {
    kind,
    format: options.format ?? "zugferd",
    number: options.number ?? (kind === "rechnung" ? "2026-034" : "2026-035"),
    issueDate: "2026-10-02",
    dueDate: "2026-10-16",
    paymentTermDays: 14,
    serviceFrom: "2026-09-01",
    serviceTo: "2026-09-30",
    currency: "EUR",
    seller: sampleSeller,
    buyer: options.buyer ?? sampleBuyer,
    lines: inputs.map((line, index) => ({
      position: index + 1,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unitPrice,
      taxRate: line.taxRate,
      net: lineNet(line.quantity, line.unitPrice),
    })),
    totals: computeInvoiceTotals(inputs),
    corrects: kind === "rechnung" ? undefined : { number: "2026-034", issueDate: "2026-09-30" },
    note: options.note,
  };
}

export const mixedRateLines: InvoiceLineInput[] = [
  { description: "Workshop „Buchhaltung für Freiberufler“", quantity: 2000, unit: "Tag", unitPrice: 120000, taxRate: 1900 },
  { description: "Fachbuch Steuerrecht", quantity: 3000, unit: "Stk.", unitPrice: 4990, taxRate: 700 },
  { description: "Fahrtkosten", quantity: 287500, unit: "km", unitPrice: 30, taxRate: 1900 },
];

import { computeInvoiceTotals } from "@haben/core";
import type { InvoiceDocument } from "@haben/einvoice";

/*
 * Rechnungen für die Tests der Erkennung eigener Ausgangsrechnungen: dieselbe Rechnung einmal von uns an einen Kunden,
 * einmal von einem Lieferanten an uns. Gerendert mit dem Rechnungslayout von Haben (Absenderzeile, Fußzeile mit
 * Steuernummer, USt-IdNr. und Bankverbindung), wie es auch ein Shop-PDF hätte.
 */

export const ownSeller = {
  name: "Musterdesign Weber",
  strasse: "Königstraße 1",
  plz: "70173",
  ort: "Stuttgart",
  land: "DE",
  email: "rechnung@musterdesign.example",
  steuernummer: "99/815/08150",
  ustId: "DE811907980",
  iban: "DE89370400440532013000",
  bic: "COBADEFFXXX",
  bank: "Commerzbank",
};

const supplier = {
  name: "Druckerei Schulze GmbH",
  strasse: "Hafenweg 3",
  plz: "20457",
  ort: "Hamburg",
  land: "DE",
  email: "rechnung@schulze.example",
  steuernummer: "22/123/45678",
  ustId: "DE812871812",
  iban: "DE92760700120750007700",
};

const customer = { name: "Kunde AG", strasse: "Hauptstraße 5", plz: "10115", ort: "Berlin", land: "DE", email: "a@kunde.example" };

export function invoiceDocument(direction: "eigene" | "eingang", format: InvoiceDocument["format"] = "zugferd"): InvoiceDocument {
  const lines = [{ description: "Gestaltung Flyer", quantity: 1000, unit: "Psch." as const, unitPrice: 50_000, taxRate: 1900 as const }];
  return {
    kind: "rechnung",
    format,
    number: direction === "eigene" ? "RE-2026-042" : "DS-77812",
    issueDate: "2026-10-01",
    dueDate: "2026-10-15",
    paymentTermDays: 14,
    currency: "EUR",
    seller: direction === "eigene" ? ownSeller : supplier,
    buyer:
      direction === "eigene"
        ? customer
        : { name: ownSeller.name, strasse: ownSeller.strasse, plz: ownSeller.plz, ort: ownSeller.ort, land: "DE", email: ownSeller.email },
    lines: lines.map((line, index) => ({ ...line, position: index + 1, net: line.unitPrice })),
    totals: computeInvoiceTotals(lines),
  };
}

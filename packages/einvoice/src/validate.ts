import { isCreditNote } from "./format.ts";
import type { InvoiceDocument } from "./types.ts";

const blank = (value: string | undefined) => !value?.trim();

/**
 * Fehlende Angaben für das gewählte Format, als deutsche Meldungen.
 * Leer heißt: PDF und XML lassen sich erzeugen.
 */
export function validateForFormat(doc: InvoiceDocument): string[] {
  const { seller, buyer } = doc;
  const problems: string[] = [];
  const xrechnung = doc.format !== "zugferd";

  if (blank(seller.name)) problems.push("Name des Rechnungsstellers fehlt");
  if (blank(seller.strasse) || blank(seller.plz) || blank(seller.ort)) problems.push("Anschrift des Rechnungsstellers unvollständig");
  if (blank(seller.email)) problems.push("E-Mail-Adresse des Rechnungsstellers fehlt");
  if (blank(seller.steuernummer) && blank(seller.ustId)) problems.push("Steuernummer oder USt-IdNr. fehlt");
  if (xrechnung && blank(seller.telefon)) problems.push("Telefonnummer fehlt (für XRechnung Pflicht)");
  if (!isCreditNote(doc) && doc.totals.gross > 0 && blank(seller.iban)) problems.push("IBAN fehlt");

  if (blank(buyer.name)) problems.push("Name des Kunden fehlt");
  if (blank(buyer.strasse) || blank(buyer.plz) || blank(buyer.ort)) problems.push("Anschrift des Kunden unvollständig");
  if (xrechnung && blank(buyer.email) && blank(buyer.leitwegId)) {
    problems.push("E-Mail-Adresse oder Leitweg-ID des Kunden fehlt (für XRechnung Pflicht)");
  }

  if (doc.lines.length === 0) problems.push("Rechnung hat keine Positionen");
  if (doc.totals.taxes.some((t) => t.rate !== 1900 && t.rate !== 700 && t.rate !== 0)) {
    problems.push("Nur Steuersätze 19 %, 7 % und 0 % werden unterstützt");
  }
  if (isCreditNote(doc) && !doc.corrects) problems.push("Bezug zur ursprünglichen Rechnung fehlt");

  return problems;
}

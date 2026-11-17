import type { TaxTreatment } from "@haben/core";
import { eq } from "drizzle-orm";
import { schema, type Tx } from "../../db/index.ts";
import type { Company, Contact } from "../stammdaten/index.ts";
import { InvoiceError } from "./invoice-error.ts";
import { storeInvoiceTaxes } from "./invoice-taxes.ts";
import { buyerFrom, type Invoice, sellerFrom, sha256 } from "./invoices.ts";
import type { RebuiltInvoice } from "./positionen-nachbilden.ts";

/** Eine Rechnung, die woanders geschrieben wurde und in Haben festgeschrieben vorliegen soll (Fremdsystem, Umzug) */
export interface TakenOverInvoice extends RebuiltInvoice {
  company: Company;
  contact: Contact;
  /** Nummer des Quellsystems; sie bleibt unverändert und darf in Haben noch nicht vergeben sein */
  number: string;
  issueDate: string;
  dueDate: string;
  paymentTermDays: number;
  serviceFrom: string | null;
  serviceTo: string | null;
  /** Leistungsdatum, wenn es sich vom Rechnungsdatum unterscheidet; sonst leer */
  serviceDate?: string | null;
  taxTreatment: TaxTreatment;
  exemptionReason?: string;
  note: string;
  /** Das Original: wird nicht neu erzeugt */
  pdf: Uint8Array;
  pdfSha256: string;
  /** Eingebettete oder mitgelieferte E-Rechnung des Originals */
  xml: string | null;
  /** Wo die Rechnung herkommt: ein Fremdsystem (externe Referenz) oder der Beleg des Quellprogramms beim Umzug */
  origin: { externalSource: string; externalId: string } | { lexofficeVoucherId: string };
}

/**
 * Legt die Rechnung festgeschrieben an (Rechnung, Positionen, Steuerzeilen, Verkäufer und Käufer von heute, Original, `lockedAt`),
 * ohne den eigenen Nummernkreis zu berühren. Gebucht wird nicht: Das unterscheidet sich je Weg (laufende Rechnung wie beim
 * Festschreiben, Umzug mit Eröffnungsbuchung) und bleibt beim Aufrufer.
 * `numberTaken` liefert den Fehler, wenn die Nummer schon vergeben ist; ohne Angabe ein `InvoiceError`.
 */
export async function createTakenOverInvoice(
  tx: Tx,
  p: TakenOverInvoice,
  numberTaken: (number: string) => Error = (number) => new InvoiceError(`Die Rechnungsnummer ${number} gibt es in Haben schon.`),
): Promise<Invoice> {
  const [clash] = await tx.select({ id: schema.invoices.id }).from(schema.invoices).where(eq(schema.invoices.number, p.number));
  if (clash) throw numberTaken(p.number);
  const [draft] = await tx
    .insert(schema.invoices)
    .values({
      kind: "rechnung",
      contactId: p.contact.id,
      issueDate: p.issueDate,
      serviceFrom: p.serviceFrom,
      serviceTo: p.serviceTo,
      paymentTermDays: p.paymentTermDays,
      dueDate: p.dueDate,
      note: p.note,
      priceMode: p.priceMode,
      taxTreatment: p.taxTreatment,
      exemptionReason: p.exemptionReason ?? "",
      net: p.totals.net,
      tax: p.totals.tax,
      gross: p.totals.gross,
    })
    .returning({ id: schema.invoices.id });
  const id = draft!.id;
  await tx.insert(schema.invoiceLines).values(p.lines.map((l) => ({ ...l, invoiceId: id })));
  await storeInvoiceTaxes(tx, id, p.totals.taxes);
  const now = new Date();
  const [invoice] = await tx
    .update(schema.invoices)
    .set({
      status: "final",
      number: p.number,
      ...p.origin,
      contactVersion: p.contact.version,
      seller: sellerFrom(p.company),
      buyer: buyerFrom(p.contact),
      ...(p.serviceDate ? { serviceDate: p.serviceDate } : {}),
      pdf: Buffer.from(p.pdf),
      pdfSha256: p.pdfSha256,
      xml: p.xml,
      xmlSha256: p.xml ? sha256(p.xml) : null,
      lockedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.invoices.id, id))
    .returning();
  return invoice!;
}

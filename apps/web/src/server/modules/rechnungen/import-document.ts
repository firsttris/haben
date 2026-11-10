import { computeInvoice } from "@haben/core";
import type { Buyer } from "@haben/einvoice";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { schema, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import type { Company } from "../stammdaten/index.ts";
import { sellerFrom } from "./invoices.ts";
import { storeInvoiceTaxes } from "./invoice-taxes.ts";

export interface ImportedDocument {
  number: string;
  date: string;
  contactId: string | null;
  buyer: Buyer;
  gross: number;
  serviceFrom: string | null;
  serviceTo: string | null;
  note: string;
  lines: { description: string; detail: string; quantity: number; unit: string; unitPrice: number; kind: "optional" | "alternative" | null }[];
}

/** Originale werden weder neu ausgestellt noch mit einer neuen Nummer gerendert. */
export async function importIssuedDocument(
  tx: Tx,
  company: Company,
  input: ImportedDocument & { source: string; externalId: string } & (
      | { kind: "quote"; validUntil: string | null; decision: "angenommen" | "abgelehnt" | null }
      | { kind: "invoice"; dueDate: string; quoteId: string | null }
    ),
  pdf: Uint8Array,
): Promise<string> {
  const all = input.lines.map((l, i) => ({ ...l, position: i + 1, taxRate: 0 as const }));
  const counted = all.filter((l) => !l.kind);
  const { totals } = computeInvoice(counted);
  if (totals.gross !== input.gross) throw new UserError(`Beleg ${input.number}: Positionen und Originalbetrag stimmen nicht überein.`);
  if (input.kind === "invoice" && all.some((l) => l.kind)) throw new UserError("Eine Rechnung enthält keine ungewählten optionalen Positionen.");
  let contactVersion: number | null = null;
  if (input.contactId) {
    const [contact] = await tx
      .select({ id: schema.contacts.id, version: schema.contacts.version })
      .from(schema.contacts)
      .where(eq(schema.contacts.id, input.contactId));
    if (!contact) throw new UserError("Der zugeordnete Kontakt fehlt.");
    contactVersion = contact.version;
  }
  const common = {
    number: input.number,
    contactId: input.contactId,
    contactVersion,
    issueDate: input.date,
    serviceFrom: input.serviceFrom,
    serviceTo: input.serviceTo,
    note: input.note,
    taxTreatment: "kleinunternehmer" as const,
    net: totals.net,
    tax: 0,
    gross: totals.gross,
    seller: sellerFrom(company),
    buyer: input.buyer,
    pdf: Buffer.from(pdf),
    pdfSha256: createHash("sha256").update(pdf).digest("hex"),
  };
  const rows = all.map(({ kind: _kind, ...l }) => ({ ...l, net: computeInvoice([l]).totals.net }));
  const now = new Date();
  if (input.kind === "quote") {
    const [quote] = await tx
      .insert(schema.quotes)
      .values({ ...common, number: null, validUntil: input.validUntil, externalSource: input.source, externalId: input.externalId })
      .returning({ id: schema.quotes.id });
    const id = quote!.id;
    await tx.insert(schema.quoteLines).values(rows.map((l, i) => ({ ...l, quoteId: id, kind: all[i]!.kind })));
    await tx
      .update(schema.quotes)
      .set({ number: input.number, status: "final", decision: input.decision, decidedAt: null, lockedAt: now, updatedAt: now })
      .where(eq(schema.quotes.id, id));
    return id;
  }
  const term = Math.round((Date.parse(input.dueDate) - Date.parse(input.date)) / 86_400_000);
  if (term < 0 || term > 32767) throw new UserError("Die Fälligkeit liegt vor dem Rechnungsdatum oder zu weit danach.");
  const [invoice] = await tx
    .insert(schema.invoices)
    .values({
      ...common,
      number: null,
      dueDate: input.dueDate,
      paymentTermDays: term,
      quoteId: input.quoteId,
      externalSource: input.source,
      externalId: input.externalId,
    })
    .returning({ id: schema.invoices.id });
  const id = invoice!.id;
  await tx.insert(schema.invoiceLines).values(rows.map((l) => ({ ...l, invoiceId: id })));
  await storeInvoiceTaxes(tx, id, totals.taxes);
  await tx.update(schema.invoices).set({ number: input.number, status: "final", lockedAt: now, updatedAt: now }).where(eq(schema.invoices.id, id));
  if (input.quoteId) await tx.update(schema.quotes).set({ invoiceId: id, decision: "angenommen" }).where(eq(schema.quotes.id, input.quoteId));
  return id;
}

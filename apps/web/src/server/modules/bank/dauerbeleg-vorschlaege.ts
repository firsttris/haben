import { documentOpen, suggestMatches, type MatchTransaction, type OpenItem, type Suggestion } from "@haben/core";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";

/*
 * Vorschläge aus Dauerbelegen für den Bankabgleich, nur lesend. Die Belege legt belege/dauerbelege-lauf.ts an und bucht
 * sie auf Klick (bookAndAllocateDauerbeleg); gelesen wird hier, weil bank unter belege steht.
 */

/** Ungebuchte Belege aus Dauerbelegen, die über das Geschäftskonto bezahlt werden: Kandidaten für den Bankabgleich */
async function pendingDauerbelegItems(): Promise<OpenItem[]> {
  const rows = await db
    .select({
      id: schema.documents.id,
      invoiceNumber: schema.documents.invoiceNumber,
      documentDate: schema.documents.documentDate,
      dueDate: schema.documents.dueDate,
      gross: schema.documents.gross,
      supplierName: schema.documents.supplierName,
      contactIban: schema.contacts.iban,
    })
    .from(schema.documents)
    .leftJoin(schema.contacts, eq(schema.contacts.id, schema.documents.supplierContactId))
    .where(and(isNotNull(schema.documents.recurringDocumentId), eq(schema.documents.status, "neu"), eq(schema.documents.payment, "bank")));
  return rows
    .filter((r) => r.gross !== 0 && r.documentDate)
    .map((r) => ({
      type: "document" as const,
      id: r.id,
      number: r.invoiceNumber,
      date: r.documentDate!,
      dueDate: r.dueDate,
      open: documentOpen(r.gross, 0),
      partyName: r.supplierName,
      partyIbans: r.contactIban ? [r.contactIban] : [],
    }));
}

/**
 * Vorschläge aus ungebuchten Dauerbelegen für einen Umsatz: nur Treffer mit passendem Betrag, damit ein Klick nicht
 * einen falschen Beleg bucht
 */
export async function dauerbelegSuggestions(tx: MatchTransaction): Promise<Suggestion[]> {
  const items = await pendingDauerbelegItems();
  return suggestMatches(tx, items).filter((s) => s.amount === s.item.open);
}

import { documentOpen, suggestMatches, type MatchTransaction, type OpenItem, type Suggestion } from "@haben/core";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";

/*
 * Vorschläge aus Dauerbelegen für den Bankabgleich, nur lesend. Die Belege legt belege/dauerbelege-lauf.ts an und bucht
 * sie auf Klick (bookAndAllocateDauerbeleg); gelesen wird hier, weil bank unter belege steht.
 */

/** Ungebuchte Belege aus Dauerbelegen, die über das Geschäftskonto bezahlt werden: Kandidaten für den Bankabgleich */
async function pendingDauerbelegItems(): Promise<{ item: OpenItem; selfAssessed: boolean }[]> {
  const rows = await db
    .select({
      id: schema.documents.id,
      invoiceNumber: schema.documents.invoiceNumber,
      documentDate: schema.documents.documentDate,
      dueDate: schema.documents.dueDate,
      gross: schema.documents.gross,
      supplierName: schema.documents.supplierName,
      reverseCharge: schema.documents.reverseCharge,
      contactIban: schema.contacts.iban,
    })
    .from(schema.documents)
    .leftJoin(schema.contacts, eq(schema.contacts.id, schema.documents.supplierContactId))
    .where(and(isNotNull(schema.documents.recurringDocumentId), eq(schema.documents.status, "neu"), eq(schema.documents.payment, "bank")));
  return rows
    .filter((r) => r.gross !== 0 && r.documentDate)
    .map((r) => ({
      item: {
        type: "document" as const,
        id: r.id,
        number: r.invoiceNumber,
        date: r.documentDate!,
        dueDate: r.dueDate,
        open: documentOpen(r.gross, 0),
        partyName: r.supplierName,
        partyIbans: r.contactIban ? [r.contactIban] : [],
      },
      selfAssessed: r.reverseCharge !== null,
    }));
}

/**
 * Vorschläge aus ungebuchten Dauerbelegen für einen Umsatz: nur Treffer mit passendem Betrag, damit ein Klick nicht
 * einen falschen Beleg bucht. selfAssessed: Der Beleg wurde auf § 13b oder innergemeinschaftlichen Erwerb umgestellt;
 * gebucht wird er dann nur auf der Belegseite, deren Rückfrage bei § 13b EU und Erwerb die USt-IdNr. beim BZSt prüft (#1595).
 */
export async function dauerbelegSuggestions(tx: MatchTransaction): Promise<(Suggestion & { selfAssessed: boolean })[]> {
  const pending = await pendingDauerbelegItems();
  const items = pending.map((p) => p.item);
  const selfAssessed = new Set(pending.filter((p) => p.selfAssessed).map((p) => p.item.id));
  return suggestMatches(tx, items)
    .filter((s) => s.amount === s.item.open)
    .map((s) => ({ ...s, selfAssessed: selfAssessed.has(s.item.id) }));
}

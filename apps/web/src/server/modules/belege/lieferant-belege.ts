import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";

/**
 * Gebuchte Belege eines Lieferanten für die Kontaktseite (#587), über die Kontakt-ID, nie über den Namen. Ein
 * stornierter Beleg kommt mit, damit er in der Liste steht; zählen tut er dort nicht.
 */
export async function supplierDocuments(contactId: string) {
  const rows = await db
    .select({
      id: schema.documents.id,
      number: schema.documents.invoiceNumber,
      filename: schema.documents.filename,
      date: schema.documents.documentDate,
      category: schema.documents.category,
      /** Zahl der Kontierungszeilen (#271); 0 = die Kategorie gilt für den ganzen Beleg */
      splitCount: sql<number>`(select count(*)::int from document_splits s where s.document_id = ${schema.documents.id})`,
      net: schema.documents.net,
      gross: schema.documents.gross,
      cancelledOn: schema.documentCancellations.date,
    })
    .from(schema.documents)
    .leftJoin(schema.documentCancellations, eq(schema.documentCancellations.documentId, schema.documents.id))
    .where(and(eq(schema.documents.supplierContactId, contactId), eq(schema.documents.status, "gebucht")));
  // Gebucht heißt mit Belegdatum; ohne wäre der Beleg nicht buchbar
  return rows.flatMap((row) => (row.date ? [{ ...row, date: row.date, splitCount: Number(row.splitCount) }] : []));
}

import { desc, eq, ilike, or } from "drizzle-orm";
import { likePattern, parseEuroSearchCents } from "../../../lib/search.ts";
import { db, schema } from "../../db/index.ts";

export interface DocumentHit {
  id: string;
  supplierName: string;
  invoiceNumber: string;
  filename: string;
  documentDate: string | null;
  gross: number | null;
  currency: string;
  status: string;
}

/** Belegsuche für die Befehlspalette (#617): Lieferant, Belegnummer, Dateiname und Betrag */
export async function searchDocuments(query: string, limit = 5): Promise<{ hits: DocumentHit[]; more: boolean }> {
  const pattern = likePattern(query);
  const queryCents = parseEuroSearchCents(query);
  const rows = await db
    .select({
      id: schema.documents.id,
      supplierName: schema.documents.supplierName,
      invoiceNumber: schema.documents.invoiceNumber,
      filename: schema.documents.filename,
      documentDate: schema.documents.documentDate,
      gross: schema.documents.gross,
      currency: schema.documents.currency,
      status: schema.documents.status,
    })
    .from(schema.documents)
    .where(
      or(
        ilike(schema.documents.supplierName, pattern),
        ilike(schema.documents.invoiceNumber, pattern),
        ilike(schema.documents.filename, pattern),
        ...(queryCents !== null ? [eq(schema.documents.gross, queryCents)] : []),
      ),
    )
    .orderBy(desc(schema.documents.documentDate), desc(schema.documents.uploadedAt))
    .limit(limit + 1);
  return { hits: rows.slice(0, limit), more: rows.length > limit };
}

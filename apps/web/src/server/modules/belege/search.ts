import { parseEuroSearchCents } from "@haben/core";
import { desc, eq, ilike, isNotNull, or } from "drizzle-orm";
import { likePattern, numberRank } from "../../../lib/search.ts";
import { db, schema } from "../../db/index.ts";

export interface DocumentHit {
  id: string;
  supplierName: string;
  invoiceNumber: string;
  filename: string;
  documentDate: string | null;
  gross: number | null;
  currency: string;
  status: typeof schema.documents.$inferSelect.status;
  cancelled: boolean;
  extractionStatus: typeof schema.documents.$inferSelect.extractionStatus;
}

/** Belegsuche für die Befehlspalette (#617): Lieferant, Belegnummer, Dateiname und Betrag */
export async function searchDocuments(query: string | { id: string }, limit = 5): Promise<{ hits: DocumentHit[]; more: boolean }> {
  const pattern = typeof query === "string" ? likePattern(query) : "";
  const queryCents = typeof query === "string" ? parseEuroSearchCents(query) : null;
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
      cancelled: isNotNull(schema.documentCancellations.documentId).mapWith(Boolean),
      extractionStatus: schema.documents.extractionStatus,
    })
    .from(schema.documents)
    .leftJoin(schema.documentCancellations, eq(schema.documentCancellations.documentId, schema.documents.id))
    .where(
      typeof query === "string"
        ? or(
            ilike(schema.documents.supplierName, pattern),
            ilike(schema.documents.invoiceNumber, pattern),
            ilike(schema.documents.filename, pattern),
            ...(queryCents !== null ? [eq(schema.documents.gross, queryCents)] : []),
          )
        : eq(schema.documents.id, query.id),
    )
    .orderBy(
      ...(typeof query === "string" ? [numberRank(schema.documents.invoiceNumber, query)] : []),
      desc(schema.documents.documentDate),
      desc(schema.documents.uploadedAt),
    )
    .limit(limit + 1);
  return { hits: rows.slice(0, limit), more: rows.length > limit };
}

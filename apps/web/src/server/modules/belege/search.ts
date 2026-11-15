import { parseDateSearch, parseEuroSearchRange } from "@haben/core";
import { desc, eq, isNotNull, or } from "drizzle-orm";
import { amountIn, likePattern, numberRank, unaccentIlike } from "../../../lib/search.ts";
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
  cancelledOn: string | null;
  lockedAt: Date | null;
  uploadedAt: Date;
  extractionStatus: typeof schema.documents.$inferSelect.extractionStatus;
}

/** Belegsuche für die Befehlspalette (#617): Lieferant, Belegnummer, Dateiname und Betrag */
export async function searchDocuments(query: string | { id: string }, limit = 5): Promise<{ hits: DocumentHit[]; more: boolean }> {
  const pattern = typeof query === "string" ? likePattern(query) : "";
  const queryRange = typeof query === "string" ? parseEuroSearchRange(query) : null;
  const queryDate = typeof query === "string" ? parseDateSearch(query) : null;
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
      cancelledOn: schema.documentCancellations.date,
      lockedAt: schema.documents.lockedAt,
      uploadedAt: schema.documents.uploadedAt,
    })
    .from(schema.documents)
    .leftJoin(schema.documentCancellations, eq(schema.documentCancellations.documentId, schema.documents.id))
    .where(
      typeof query === "string"
        ? or(
            unaccentIlike(schema.documents.supplierName, pattern),
            unaccentIlike(schema.documents.invoiceNumber, pattern),
            unaccentIlike(schema.documents.filename, pattern),
            ...(queryRange !== null ? [amountIn(schema.documents.gross, queryRange)] : []),
            ...(queryDate !== null ? [eq(schema.documents.documentDate, queryDate)] : []),
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

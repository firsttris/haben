import { parseDateSearch, parseEuroSearchRange } from "@haben/core";
import { desc, eq, isNotNull, or } from "drizzle-orm";
import { amountIn, likePattern, numberRank, unaccentIlike } from "../../../lib/search.ts";
import { db, schema } from "../../db/index.ts";
import { firstHits, partsFor, runSearchParts, searchPart } from "../../db/search-parts.ts";
import { recurringDocumentsPart } from "./search-recurring.ts";

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

/** Belege für die Befehlspalette (#617): Lieferant, Belegnummer, Dateiname und Betrag */
function documentsPart(query: string | { id: string }, limit: number) {
  const d = schema.documents;
  const pattern = typeof query === "string" ? likePattern(query) : "";
  const queryRange = typeof query === "string" ? parseEuroSearchRange(query) : null;
  const queryDate = typeof query === "string" ? parseDateSearch(query) : null;
  return searchPart(
    {
      id: d.id,
      supplierName: d.supplierName,
      invoiceNumber: d.invoiceNumber,
      filename: d.filename,
      documentDate: d.documentDate,
      gross: d.gross,
      currency: d.currency,
      status: d.status,
      cancelled: isNotNull(schema.documentCancellations.documentId).mapWith(Boolean),
      extractionStatus: d.extractionStatus,
      cancelledOn: schema.documentCancellations.date,
      lockedAt: d.lockedAt,
      uploadedAt: d.uploadedAt,
    },
    (fields) =>
      db
        .select(fields)
        .from(d)
        .leftJoin(schema.documentCancellations, eq(schema.documentCancellations.documentId, d.id))
        .where(
          typeof query === "string"
            ? or(
                unaccentIlike(d.supplierName, pattern),
                unaccentIlike(d.invoiceNumber, pattern),
                unaccentIlike(d.filename, pattern),
                ...(queryRange !== null ? [amountIn(d.gross, queryRange)] : []),
                ...(queryDate !== null ? [eq(d.documentDate, queryDate)] : []),
              )
            : eq(d.id, query.id),
        )
        .orderBy(...(typeof query === "string" ? [numberRank(d.invoiceNumber, query)] : []), desc(d.documentDate), desc(d.uploadedAt))
        .limit(limit + 1),
    (rows): { hits: DocumentHit[]; more: boolean } => firstHits(rows, limit),
  );
}

/** Belege und Dauerbelege für die Befehlspalette in einer Abfrage, nur die gefragten Gruppen */
export function searchBelege(query: string, groups: readonly string[], limit = 5) {
  return runSearchParts(
    partsFor(groups, {
      documents: () => documentsPart(query, limit),
      recurringDocuments: () => recurringDocumentsPart(query, limit),
    }),
  );
}

/** Ein Beleg für „Zuletzt angesehen“ in der Befehlspalette */
export async function searchDocuments(query: { id: string }, limit = 1): Promise<{ hits: DocumentHit[]; more: boolean }> {
  return (await runSearchParts({ documents: documentsPart(query, limit) })).documents;
}

import { parseDateSearch, parseEuroSearchRange } from "@haben/core";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { amountIn, amountInEitherSign, likePattern, unaccentIlike } from "../../../lib/search.ts";
import { db, schema } from "../../db/index.ts";
import { runSearchParts, searchPart } from "../../db/search-parts.ts";

export interface ArchiveHit {
  id: string;
  target: "auftrag" | "beleg";
  number: string;
  contactName: string;
  date: string;
  gross: number | null;
  source: string;
}

/** Die Einstellung `archiveSearch` (Vorgabe an) als Bedingung, damit sie keine eigene Abfrage braucht */
const archiveSearchEnabled = sql`coalesce((select c.archive_search from company c limit 1), true)`;

const archiveFields = (t: typeof schema.lexofficeVouchers | typeof schema.legacyOrderDocuments) => ({
  id: t.id,
  number: t.number,
  contactName: t.contactName,
  date: t.date,
  gross: t.gross,
  source: t.source,
});

/**
 * Archiv aus dem Umzug für die Befehlspalette (#617): Aufträge und Belege aus Lexoffice/sevDesk/BuchhaltungsButler in einer
 * Abfrage. Nur aktiv, wenn die Einstellung `archiveSearch` eingeschaltet ist (Vorgabe an).
 */
export async function searchArchive(query: string, limit = 5): Promise<{ hits: ArchiveHit[]; more: boolean }> {
  const pattern = likePattern(query);
  const range = parseEuroSearchRange(query);
  const queryDate = parseDateSearch(query);

  const lv = schema.lexofficeVouchers;
  const lo = schema.legacyOrderDocuments;

  const { vouchers, orders } = await runSearchParts({
    vouchers: searchPart(
      archiveFields(lv),
      (fields) =>
        db
          .select(fields)
          .from(lv)
          .where(
            and(
              archiveSearchEnabled,
              or(
                unaccentIlike(lv.number, pattern),
                unaccentIlike(lv.contactName, pattern),
                unaccentIlike(lv.remark, pattern),
                ...(range !== null ? [amountInEitherSign(lv.gross, range)] : []),
                ...(queryDate !== null ? [eq(lv.date, queryDate)] : []),
              ),
            ),
          )
          .orderBy(desc(lv.date))
          .limit(limit + 1),
      (rows) => rows.map((v) => ({ ...v, target: "beleg" as const })),
    ),
    orders: searchPart(
      archiveFields(lo),
      (fields) =>
        db
          .select(fields)
          .from(lo)
          .where(
            and(
              archiveSearchEnabled,
              or(
                unaccentIlike(lo.number, pattern),
                unaccentIlike(lo.contactName, pattern),
                ...(range !== null ? [amountIn(lo.gross, range)] : []),
                ...(queryDate !== null ? [eq(lo.date, queryDate)] : []),
              ),
            ),
          )
          .orderBy(desc(lo.date))
          .limit(limit + 1),
      (rows) => rows.map((o) => ({ ...o, target: "auftrag" as const })),
    ),
  });

  const merged: ArchiveHit[] = [...vouchers, ...orders].sort((a, b) => b.date.localeCompare(a.date));
  return { hits: merged.slice(0, limit), more: merged.length > limit };
}

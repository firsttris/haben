import { parseDateSearch, parseEuroSearchRange } from "@haben/core";
import { desc, eq, or } from "drizzle-orm";
import { amountIn, amountInEitherSign, likePattern, unaccentIlike } from "../../../lib/search.ts";
import { db, schema } from "../../db/index.ts";

export interface ArchiveHit {
  id: string;
  target: "auftrag" | "beleg";
  number: string;
  contactName: string;
  date: string;
  gross: number | null;
  source: string;
}

async function isArchiveSearchEnabled(): Promise<boolean> {
  const [row] = await db.select({ archiveSearch: schema.company.archiveSearch }).from(schema.company).limit(1);
  return row?.archiveSearch ?? true;
}

/**
 * Archiv aus dem Umzug für die Befehlspalette (#617): Aufträge und Belege aus Lexoffice/sevDesk/BuchhaltungsButler.
 * Nur aktiv, wenn die Einstellung `archiveSearch` eingeschaltet ist (Vorgabe an).
 */
export async function searchArchive(query: string, limit = 5): Promise<{ hits: ArchiveHit[]; more: boolean }> {
  if (!(await isArchiveSearchEnabled())) return { hits: [], more: false };

  const pattern = likePattern(query);
  const range = parseEuroSearchRange(query);
  const queryDate = parseDateSearch(query);

  const lv = schema.lexofficeVouchers;
  const lo = schema.legacyOrderDocuments;

  const [vouchers, orders] = await Promise.all([
    db
      .select({ id: lv.id, number: lv.number, contactName: lv.contactName, date: lv.date, gross: lv.gross, source: lv.source })
      .from(lv)
      .where(
        or(
          unaccentIlike(lv.number, pattern),
          unaccentIlike(lv.contactName, pattern),
          unaccentIlike(lv.remark, pattern),
          ...(range !== null ? [amountInEitherSign(lv.gross, range)] : []),
          ...(queryDate !== null ? [eq(lv.date, queryDate)] : []),
        ),
      )
      .orderBy(desc(lv.date))
      .limit(limit + 1),
    db
      .select({ id: lo.id, number: lo.number, contactName: lo.contactName, date: lo.date, gross: lo.gross, source: lo.source })
      .from(lo)
      .where(
        or(
          unaccentIlike(lo.number, pattern),
          unaccentIlike(lo.contactName, pattern),
          ...(range !== null ? [amountIn(lo.gross, range)] : []),
          ...(queryDate !== null ? [eq(lo.date, queryDate)] : []),
        ),
      )
      .orderBy(desc(lo.date))
      .limit(limit + 1),
  ]);

  const merged: ArchiveHit[] = [
    ...vouchers.map((v) => ({ ...v, target: "beleg" as const })),
    ...orders.map((o) => ({ ...o, target: "auftrag" as const })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return { hits: merged.slice(0, limit), more: merged.length > limit };
}

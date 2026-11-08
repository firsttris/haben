import { type ExpenseCategory, gelernteBezahlung, mostFrequent, type Zahlweg } from "@haben/core";
import { and, eq, or, type SQL, sql } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { documentNotCancelled } from "../../db/document-cancelled.ts";

/*
 * Vorschläge für einen Beleg aus den gebuchten Belegen desselben Lieferanten (#295), ohne KI-Modell: Kategorie und
 * Bezahlung, mit Anzahl und Zeitpunkt der letzten Buchung für die Begründung. Ein stornierter Beleg war oft falsch
 * erfasst und zählt nicht.
 */

/** Wie der Lieferant eines Belegs erkannt wird: gewählter Kontakt, USt-IdNr. oder Name (ohne Groß- und Kleinschreibung) */
export interface Lieferant {
  supplierName: string;
  supplierUstId: string;
  supplierContactId: string | null;
}

/** Gebuchte, nicht stornierte Belege desselben Lieferanten; null ohne jedes Merkmal */
function desselbenLieferanten({ supplierName, supplierUstId, supplierContactId }: Lieferant): SQL | null {
  const name = supplierName.trim();
  const ustId = supplierUstId.trim();
  const merkmale = [
    supplierContactId ? eq(schema.documents.supplierContactId, supplierContactId) : null,
    ustId ? eq(schema.documents.supplierUstId, ustId) : null,
    name ? sql`lower(btrim(${schema.documents.supplierName})) = lower(${name})` : null,
  ].filter((m): m is SQL => m !== null);
  if (merkmale.length === 0) return null;
  return and(eq(schema.documents.status, "gebucht"), documentNotCancelled(), or(...merkmale)) ?? null;
}

/**
 * Kategorie aus den gebuchten Belegen desselben Lieferanten: die häufigste, bei Gleichstand die zuletzt gebuchte, mit
 * Anzahl und letzter Buchung für die Begründung („7 von 9 Belegen als Software gebucht, zuletzt am …“). Ein aufgeteilter
 * Beleg zählt bei jeder seiner Kategorien, insgesamt aber einmal.
 */
export async function supplierCategory(lieferant: Lieferant): Promise<{ category: ExpenseCategory; count: number; total: number; last: string } | null> {
  const filter = desselbenLieferanten(lieferant);
  if (!filter) return null;
  const rows = await db.execute<{ category: string; count: number; last: string; total: number }>(sql`
    with belege as (
      select ${schema.documents.id} as id, ${schema.documents.category} as category, ${schema.documents.lockedAt} as locked_at
        from ${schema.documents} where ${filter}
    ),
    kategorien as (
      select b.id, coalesce(s.category, b.category) as category, b.locked_at
        from belege b left join ${schema.documentSplits} s on s.document_id = b.id
    )
    select category, count(distinct id)::int as count, max(locked_at) as last,
           (select count(distinct id) from kategorien where category is not null)::int as total
      from kategorien where category is not null group by category`);
  const total = rows[0]?.total ?? 0;
  const top = mostFrequent(
    rows.map((r) => ({ value: r.category as ExpenseCategory, count: r.count, last: new Date(r.last).toISOString() })),
    total,
  );
  return top ? { category: top.value, count: top.count, total: top.total, last: top.last } : null;
}

/** Bezahlung aus den gebuchten Belegen desselben Lieferanten, ab zwei Belegen mit Mehrheit (gelernteBezahlung) */
export async function supplierPayment(lieferant: Lieferant): Promise<{ payment: Zahlweg; count: number; total: number; last: string } | null> {
  const filter = desselbenLieferanten(lieferant);
  if (!filter) return null;
  const rows = await db
    .select({ payment: schema.documents.payment, count: sql<number>`count(*)::int`, last: sql<Date>`max(${schema.documents.lockedAt})` })
    .from(schema.documents)
    .where(filter)
    .groupBy(schema.documents.payment);
  const top = gelernteBezahlung(rows.map((r) => ({ value: r.payment, count: r.count, last: new Date(r.last).toISOString() })));
  return top ? { payment: top.value, count: top.count, total: top.total, last: top.last } : null;
}

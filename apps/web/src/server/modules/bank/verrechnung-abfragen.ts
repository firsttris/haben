import { eq, asc, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";

/*
 * Lesende Abfragen zur Verrechnung zweier Eingangsbelege (#274, verrechnung.ts): Verrechnungen eines Belegs, mögliche
 * Gegenbelege und der offene Rest.
 */

/** Lieferantenname für den Vergleich: ohne Rand- und Mehrfach-Leerzeichen, klein geschrieben (wie die Kandidatenliste) */
export function lieferant(name: string | null): string {
  return (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Verrechnungen eines Belegs, beide Richtungen, älteste zuerst */
export async function listSettlements(documentId: string, q: Db | Tx = db) {
  return q
    .select({
      id: schema.documentSettlements.id,
      amount: schema.documentSettlements.amount,
      date: schema.documentSettlements.date,
      note: schema.documentSettlements.note,
      reversesId: schema.documentSettlements.reversesId,
      counterDocumentId: schema.documentSettlements.counterDocumentId,
      counterDate: schema.documents.documentDate,
      counterSupplier: schema.documents.supplierName,
      counterGross: schema.documents.gross,
    })
    .from(schema.documentSettlements)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentSettlements.counterDocumentId))
    .where(eq(schema.documentSettlements.documentId, documentId))
    .orderBy(asc(schema.documentSettlements.date), asc(schema.documentSettlements.createdAt));
}

/**
 * Offene Belege desselben Lieferanten, die als Gegenbeleg in Frage kommen (anderes Vorzeichen)
 *
 * Der Lieferant wird in JavaScript verglichen, nicht per `lower()` in SQL: `settleDocuments` entscheidet ebenfalls
 * in JavaScript, und nur derselbe Normalisierer (`lieferant`) garantiert, dass die Liste genau die Paare anbietet,
 * die der Server annimmt. Postgres `lower()` und JavaScript `toLowerCase()` falten Unicode unterschiedlich — bei
 * İ (U+0130) ergibt `lower()` in UTF-8 „istanbul“, `toLowerCase()` dagegen „i“ plus kombinierenden Punkt (U+0307).
 * In Datenbanken ohne UTF-8-Locale (lc_ctype = 'C') faltet `lower()` außerdem nur ASCII, also „MÜLLER“ nicht zu
 * „müller“.
 *
 * Das Limit von 50 greift erst nach dem Filtern: Sonst verdrängten fremde Belege mit jüngerem Datum die passenden
 * Kandidaten aus der Liste.
 */
export async function settlementCandidates(documentId: string, q: Db | Tx = db) {
  const [doc] = await q
    .select({
      supplier: schema.documents.supplierName,
      gross: schema.documents.gross,
      status: schema.documents.status,
      payment: schema.documents.payment,
    })
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId));
  // Dieselben Bedingungen wie in settleDocuments: der geöffnete Beleg muss gebucht sein und über die Bank laufen
  if (doc?.status !== "gebucht" || doc.payment !== "bank") return [];
  // Ohne Lieferanten gibt es keinen Gegenbeleg: settleDocuments lehnt den Beleg ab, und ein Vergleich mit „“ träfe
  // jeden Beleg ohne Lieferanten (siehe `lieferant`).
  const name = lieferant(doc.supplier);
  if (!name) return [];
  // Ein stornierter Beleg lässt sich nicht verrechnen; die Liste bietet ihn deshalb auch nicht an (docs/belege-bezahlen.md)
  const storniert = await q.execute<{ id: string }>(sql`select id from document_cancellations where document_id = ${documentId} limit 1`);
  if (storniert.length > 0) return [];
  const rows = await q.execute<{
    id: string;
    document_date: string;
    supplier_name: string;
    gross: number;
    rest: string;
  }>(sql`
    select d.id, d.document_date, d.supplier_name, d.gross,
           d.gross + coalesce((select sum(a.amount) from allocations a where a.document_id = d.id), 0)
                   + coalesce((select sum(w.amount) from write_offs w where w.document_id = d.id), 0)
                   + coalesce((select sum(s.amount) from document_settlements s where s.document_id = d.id), 0) as rest
      from documents d
     where d.id <> ${documentId}
       and d.status = 'gebucht'
       and d.payment = 'bank'
       and not exists (select 1 from document_cancellations c where c.document_id = d.id)
       and sign(d.gross) <> sign(${doc.gross ?? 0})
     order by d.document_date desc`);
  // Erst filtern, dann begrenzen: der Lieferantenvergleich läuft in JavaScript (`lieferant`), nicht im SQL
  return [...rows]
    .filter((r) => Number(r.rest) !== 0 && lieferant(r.supplier_name) === name)
    .slice(0, 50)
    .map((r) => ({ id: r.id, date: r.document_date, supplier: r.supplier_name, gross: Number(r.gross), rest: Number(r.rest) }));
}

/** Offener Betrag eines Belegs (brutto minus Zuordnungen, Ausbuchungen und Verrechnungen) */
export async function openAmount(documentId: string, q: Db | Tx = db): Promise<number> {
  const rows = await q.execute<{ rest: string }>(sql`
    select d.gross
           + coalesce((select sum(a.amount) from allocations a where a.document_id = d.id), 0)
           + coalesce((select sum(w.amount) from write_offs w where w.document_id = d.id), 0)
           + coalesce((select sum(s.amount) from document_settlements s where s.document_id = d.id), 0) as rest
      from documents d where d.id = ${documentId}`);
  return Number([...rows][0]?.rest ?? 0);
}

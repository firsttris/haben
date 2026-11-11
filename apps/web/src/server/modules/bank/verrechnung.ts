import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { settledOn } from "./bank.ts";

/*
 * Verrechnung zweier Eingangsbelege ohne Zahlung (#274): eine Gutschrift des Lieferanten gleicht eine
 * oder mehrere Rechnungen aus. Beide Belege bleiben erhalten, es entsteht kein Bankumsatz und kein
 * Kassenstand ändert sich. Je Verrechnung zwei Zeilen in `document_settlements`, damit jede Seite für
 * sich als erledigt zählt; aufgehoben wird per Gegenzeile wie bei den Ausbuchungen.
 */

export const settlementSchema = z.object({
  /** Beleg, von dem aus verrechnet wird (in der Oberfläche der gerade offene) */
  documentId: z.uuid(),
  /** Der Gegenbeleg, etwa die Gutschrift des Lieferanten */
  counterDocumentId: z.uuid(),
  /** Betrag ohne Vorzeichen; die Richtung ergibt sich aus den offenen Resten */
  amount: z.number().int().positive(),
  /** Buchungsdatum der Verrechnung; ohne Angabe das spätere der beiden Belegdaten */
  date: z.iso.date().optional(),
  note: z.string().trim().max(500).default(""),
});

export type SettlementInput = z.input<typeof settlementSchema>;

export class SettlementError extends Error {}

async function beleg(tx: Tx, id: string) {
  const [row] = await tx
    .select({
      id: schema.documents.id,
      date: schema.documents.documentDate,
      supplier: schema.documents.supplierName,
      gross: schema.documents.gross,
      payment: schema.documents.payment,
      status: schema.documents.status,
    })
    .from(schema.documents)
    .where(eq(schema.documents.id, id));
  if (!row) throw new SettlementError("Beleg nicht gefunden.");
  return row;
}

/**
 * Verrechnet zwei Belege gegeneinander. Der Betrag wird von beiden offenen Resten abgezogen, keiner
 * der beiden darf dadurch umschlagen. Für eine Gutschrift (negativer Beleg) ist der offene Rest
 * negativ; die Zeile bekommt dann ein positives Vorzeichen.
 */
export async function settleDocuments(actor: string, input: SettlementInput) {
  const parsed = settlementSchema.parse(input);
  if (parsed.documentId === parsed.counterDocumentId) throw new SettlementError("Ein Beleg lässt sich nicht mit sich selbst verrechnen.");
  return withActor(actor, async (tx) => {
    const a = await beleg(tx, parsed.documentId);
    const b = await beleg(tx, parsed.counterDocumentId);
    for (const d of [a, b]) {
      if (d.status !== "gebucht") throw new SettlementError(`Beleg ${d.date ?? ""} ist nicht gebucht.`);
      if (d.payment !== "bank") throw new SettlementError(`Beleg ${d.date ?? ""} läuft nicht über die Bank und hat keinen offenen Posten.`);
    }
    const storniert = await tx
      .select({ id: schema.documentCancellations.documentId })
      .from(schema.documentCancellations)
      .where(inArray(schema.documentCancellations.documentId, [a.id, b.id]));
    if (storniert.length > 0) throw new SettlementError("Ein Beleg ist storniert und lässt sich nicht verrechnen.");
    const restA = (a.gross ?? 0) + (await settledOn(tx, "document_id", a.id));
    const restB = (b.gross ?? 0) + (await settledOn(tx, "document_id", b.id));
    if (restA === 0 || restB === 0) throw new SettlementError("Einer der Belege ist bereits ausgeglichen.");
    if (Math.sign(restA) === Math.sign(restB)) {
      throw new SettlementError("Beide Belege zeigen in dieselbe Richtung; zu verrechnen sind eine Rechnung und eine Gutschrift.");
    }
    const moeglich = Math.min(Math.abs(restA), Math.abs(restB));
    if (parsed.amount > moeglich) {
      throw new SettlementError(`Mehr als ${(moeglich / 100).toFixed(2)} EUR lassen sich nicht verrechnen.`);
    }
    const datumA = a.date ?? "";
    const datumB = b.date ?? "";
    // Math.max taugt hier nicht: es rechnet die Datumsstrings in Zahlen um und ergibt NaN
    const date = parsed.date ?? (datumA.localeCompare(datumB) >= 0 ? datumA : datumB);
    const rows = await tx
      .insert(schema.documentSettlements)
      .values([
        { documentId: a.id, counterDocumentId: b.id, date, amount: -parsed.amount, note: parsed.note, createdBy: actor },
        { documentId: b.id, counterDocumentId: a.id, date, amount: parsed.amount, note: parsed.note, createdBy: actor },
      ])
      .returning({ id: schema.documentSettlements.id });
    return { ids: rows.map((r) => r.id), amount: parsed.amount, date };
  });
}

/** Hebt eine Verrechnung auf: je Zeile eine Gegenzeile, wie bei den Ausbuchungen */
export async function reverseSettlement(actor: string, id: string) {
  return withActor(actor, async (tx) => {
    const [row] = await tx.select().from(schema.documentSettlements).where(eq(schema.documentSettlements.id, id)).for("update");
    if (!row) throw new SettlementError("Verrechnung nicht gefunden.");
    if (row.reversesId) throw new SettlementError("Diese Zeile ist bereits eine Gegenzeile.");
    const [already] = await tx
      .select({ id: schema.documentSettlements.id })
      .from(schema.documentSettlements)
      .where(eq(schema.documentSettlements.reversesId, id));
    if (already) throw new SettlementError("Die Verrechnung ist bereits aufgehoben.");
    const partner = await tx
      .select()
      .from(schema.documentSettlements)
      .where(
        and(
          eq(schema.documentSettlements.documentId, row.counterDocumentId),
          eq(schema.documentSettlements.counterDocumentId, row.documentId),
          eq(schema.documentSettlements.amount, -row.amount),
        ),
      );
    const gegenzeilen = [
      {
        documentId: row.documentId,
        counterDocumentId: row.counterDocumentId,
        date: row.date,
        amount: -row.amount,
        note: row.note,
        reversesId: row.id,
        createdBy: actor,
      },
      ...partner.map((p) => ({
        documentId: p.documentId,
        counterDocumentId: p.counterDocumentId,
        date: p.date,
        amount: -p.amount,
        note: p.note,
        reversesId: p.id,
        createdBy: actor,
      })),
    ];
    await tx.insert(schema.documentSettlements).values(gegenzeilen);
    return { ok: true as const };
  });
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

/** Offene Belege desselben Lieferanten, die als Gegenbeleg in Frage kommen (anderes Vorzeichen) */
export async function settlementCandidates(documentId: string, q: Db | Tx = db) {
  const [doc] = await q
    .select({ supplier: schema.documents.supplierName, gross: schema.documents.gross })
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId));
  if (!doc) return [];
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
       and lower(d.supplier_name) = lower(${doc.supplier ?? ""})
       and sign(d.gross) <> sign(${doc.gross ?? 0})
     order by d.document_date desc
     limit 50`);
  return [...rows]
    .filter((r) => Number(r.rest) !== 0)
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

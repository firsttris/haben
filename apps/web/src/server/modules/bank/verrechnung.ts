import { randomUUID } from "node:crypto";
import { formatEuro } from "@haben/core";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { today } from "../../today.ts";
import { settledOn } from "./bank.ts";

/*
 * Verrechnung zweier Eingangsbelege ohne Zahlung (#274): eine Gutschrift des Lieferanten gleicht eine
 * oder mehrere Rechnungen aus. Beide Belege bleiben erhalten, es entsteht kein Bankumsatz und kein
 * Kassenstand ändert sich. Je Verrechnung zwei Zeilen in `document_settlements`, damit jede Seite für
 * sich als erledigt zählt; aufgehoben wird per Gegenzeile wie bei den Ausbuchungen.
 *
 * Beide Zeilen einer Verrechnung tragen dieselbe `settlement_id`: Aufheben trifft damit genau dieses Paar,
 * auch wenn zwischen denselben Belegen mehrfach derselbe Betrag verrechnet wurde. Die Gegenzeilen einer
 * Aufhebung bilden ihrerseits ein Paar mit eigener Kennung.
 */

export const settlementSchema = z.object({
  /** Beleg, von dem aus verrechnet wird (in der Oberfläche der gerade offene) */
  documentId: z.uuid(),
  /** Der Gegenbeleg, etwa die Gutschrift des Lieferanten */
  counterDocumentId: z.uuid(),
  /** Betrag ohne Vorzeichen; die Richtung ergibt sich aus den offenen Resten */
  amount: z.number().int().positive(),
  /** Tag der Aufrechnung; verrechnet wird, wenn aufgerechnet wird, nicht rückwirkend */
  date: z.iso.date(),
  /** Grund der Verrechnung, etwa die Nummer der Gutschrift */
  note: z.string().trim().min(1, "Bitte den Grund der Verrechnung angeben.").max(500),
});

/** Aufhebung einer Verrechnung: Pflicht ist der Tag, an dem sie erklärt wird */
export const reversalSchema = z.object({
  /** Zeile der Verrechnung, die aufgehoben wird */
  id: z.uuid(),
  /** Tag der Aufhebung; sie wirkt an diesem Tag, nicht rückwirkend */
  date: z.iso.date(),
  /** Ergänzung zur Aufhebung, etwa der Grund */
  note: z.string().trim().max(500).optional(),
});

export type SettlementInput = z.input<typeof settlementSchema>;

export class SettlementError extends UserError {}

/** Ein Beleg, wie ihn Verrechnung und Aufhebung brauchen; `sperren` nimmt die Zeilensperre der Transaktion */
async function beleg(tx: Tx, id: string, sperren = false) {
  const abfrage = tx
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
  const [row] = sperren ? await abfrage.for("update") : await abfrage;
  if (!row) throw new SettlementError("Beleg nicht gefunden.");
  return row;
}

/** Lieferantenname für den Vergleich: ohne Rand- und Mehrfach-Leerzeichen, klein geschrieben (wie die Kandidatenliste) */
function lieferant(name: string | null): string {
  return (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Abgeschlossene Jahre nehmen keine Verrechnung mehr an, so wie das Hauptbuch keine Buchung mehr (ledger.post) */
async function pruefeJahrOffen(tx: Tx, date: string) {
  const jahr = Number(date.slice(0, 4));
  const [closed] = await tx.select({ year: schema.yearClosings.year }).from(schema.yearClosings).where(eq(schema.yearClosings.year, jahr));
  if (closed) throw new SettlementError(`Das Jahr ${jahr} ist abgeschlossen; Verrechnungen mit Datum darin sind nicht mehr möglich.`);
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
    // Sperre wie beim Bankabgleich: Zwei gleichzeitige Verrechnungen könnten denselben Rest sonst zweimal verbrauchen.
    // Beide Belege in fester Reihenfolge sperren, sonst blockieren sich zwei Aufrufe mit vertauschten Rollen gegenseitig.
    const gesperrt = new Map<string, Awaited<ReturnType<typeof beleg>>>();
    for (const id of [parsed.documentId, parsed.counterDocumentId].sort()) gesperrt.set(id, await beleg(tx, id, true));
    const a = gesperrt.get(parsed.documentId)!;
    const b = gesperrt.get(parsed.counterDocumentId)!;
    for (const d of [a, b]) {
      if (d.status !== "gebucht") throw new SettlementError(`Beleg ${d.date ?? ""} ist nicht gebucht.`);
      if (d.payment !== "bank") throw new SettlementError(`Beleg ${d.date ?? ""} läuft nicht über die Bank und hat keinen offenen Posten.`);
    }
    // Eine Gutschrift gleicht nur Belege desselben Lieferanten aus (docs/belege.md); die Kandidatenliste filtert danach,
    // der Server muss es selbst prüfen.
    const nameA = lieferant(a.supplier);
    const nameB = lieferant(b.supplier);
    if (!nameA || !nameB) {
      throw new SettlementError("Bei einem der Belege fehlt der Lieferant; ohne ihn lässt sich nicht prüfen, ob die Gutschrift dazugehört.");
    }
    if (nameA !== nameB) {
      throw new SettlementError(
        `Die Belege stammen von verschiedenen Lieferanten (${a.supplier} und ${b.supplier}); eine Gutschrift gleicht nur Belege desselben Lieferanten aus.`,
      );
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
      throw new SettlementError(`Mehr als ${formatEuro(moeglich)} lassen sich nicht verrechnen.`);
    }
    const datumA = a.date ?? "";
    const datumB = b.date ?? "";
    // Math.max taugt hier nicht: es rechnet die Datumsstrings in Zahlen um und ergibt NaN
    const juenger = datumA.localeCompare(datumB) >= 0 ? datumA : datumB;
    if (parsed.date < juenger) {
      throw new SettlementError(
        `Das Datum liegt vor dem jüngeren der beiden Belege (${juenger}). Steuerlich zählt die Aufrechnungserklärung, nicht eine Rückwirkung.`,
      );
    }
    if (parsed.date > today()) throw new SettlementError("Das Datum der Verrechnung liegt in der Zukunft.");
    await pruefeJahrOffen(tx, parsed.date);
    const date = parsed.date;
    // Gemeinsame Kennung für beide Zeilen: die Aufhebung findet das Paar damit eindeutig
    const settlementId = randomUUID();
    // Das Vorzeichen kommt aus dem offenen Rest, nicht aus der Rolle des Belegs: die Zeile muss den Rest
    // gegen Null bewegen. Fest an documentId/counterDocumentId gebunden waere es falsch, sobald der geoeffnete
    // Beleg die Gutschrift ist (negativer Rest) — dann waechst der offene Rest auf beiden Seiten.
    const rows = await tx
      .insert(schema.documentSettlements)
      .values([
        { documentId: a.id, counterDocumentId: b.id, settlementId, date, amount: -Math.sign(restA) * parsed.amount, note: parsed.note, createdBy: actor },
        { documentId: b.id, counterDocumentId: a.id, settlementId, date, amount: -Math.sign(restB) * parsed.amount, note: parsed.note, createdBy: actor },
      ])
      .returning({ id: schema.documentSettlements.id });
    return { ids: rows.map((r) => r.id), amount: parsed.amount, date };
  });
}

/**
 * Hebt eine Verrechnung auf: je Zeile eine Gegenzeile, wie bei den Ausbuchungen. Die Gegenzeilen tragen den Tag der
 * Aufhebung, nicht den der Verrechnung: Eine Aufhebung wirkt wie jede Storno-Buchung an dem Tag, an dem sie erklärt wird.
 * Sonst änderte sie die EÜR eines Jahres nachträglich, das schon gemeldet oder festgeschrieben ist.
 */
export async function reverseSettlement(actor: string, id: string, date: string, note?: string) {
  const parsed = reversalSchema.parse({ id, date, note });
  return withActor(actor, async (tx) => {
    // Erst die Paar-Kennung lesen, dann beide Zeilen des Paars in fester Reihenfolge sperren: so treffen sich zwei
    // gleichzeitige Aufhebungen nicht im Kreis und die Aufhebung trifft genau diese Verrechnung.
    const [gefunden] = await tx
      .select({ settlementId: schema.documentSettlements.settlementId })
      .from(schema.documentSettlements)
      .where(eq(schema.documentSettlements.id, parsed.id));
    if (!gefunden) throw new SettlementError("Verrechnung nicht gefunden.");
    const paar = await tx
      .select()
      .from(schema.documentSettlements)
      .where(eq(schema.documentSettlements.settlementId, gefunden.settlementId))
      .orderBy(asc(schema.documentSettlements.id))
      .for("update");
    const row = paar.find((r) => r.id === parsed.id);
    if (!row) throw new SettlementError("Verrechnung nicht gefunden.");
    if (row.reversesId) throw new SettlementError("Diese Zeile ist bereits eine Gegenzeile.");
    const partner = paar.find((r) => r.id !== row.id && r.reversesId === null);
    if (!partner) throw new SettlementError("Zu dieser Verrechnung fehlt die zweite Zeile; sie lässt sich nicht aufheben.");
    const [already] = await tx
      .select({ id: schema.documentSettlements.id })
      .from(schema.documentSettlements)
      .where(eq(schema.documentSettlements.reversesId, row.id));
    if (already) throw new SettlementError("Die Verrechnung ist bereits aufgehoben.");
    // Wie beim Verrechnen: keine Rückwirkung, keine Zukunft
    if (parsed.date < row.date) {
      throw new SettlementError(
        `Das Datum liegt vor der Verrechnung (${row.date}). Eine Aufhebung wirkt an dem Tag, an dem sie erklärt wird, nicht rückwirkend.`,
      );
    }
    if (parsed.date > today()) throw new SettlementError("Das Datum der Aufhebung liegt in der Zukunft.");
    await pruefeJahrOffen(tx, parsed.date);
    /** Notiz der Gegenzeile: sie nennt die Aufhebung und, wenn angegeben, den Grund */
    const aufhebung = (alt: string) => (parsed.note ? `Aufhebung: ${alt} (${parsed.note})` : `Aufhebung: ${alt}`);
    // Die Gegenzeilen sind selbst ein Paar: beide mit derselben, neuen Kennung
    const settlementId = randomUUID();
    await tx.insert(schema.documentSettlements).values([
      {
        documentId: row.documentId,
        counterDocumentId: row.counterDocumentId,
        settlementId,
        date: parsed.date,
        amount: -row.amount,
        note: aufhebung(row.note),
        reversesId: row.id,
        createdBy: actor,
      },
      {
        documentId: partner.documentId,
        counterDocumentId: partner.counterDocumentId,
        settlementId,
        date: parsed.date,
        amount: -partner.amount,
        note: aufhebung(partner.note),
        reversesId: partner.id,
        createdBy: actor,
      },
    ]);
    return { ok: true as const, date: parsed.date };
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
  // Ohne Lieferanten gibt es keinen Gegenbeleg: settleDocuments lehnt den Beleg ab, und ein Vergleich mit „“ träfe
  // jeden Beleg ohne Lieferanten (siehe `lieferant`).
  const name = lieferant(doc.supplier);
  if (!name) return [];
  // Ein stornierter Beleg lässt sich nicht verrechnen; die Liste bietet ihn deshalb auch nicht an (docs/belege.md)
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
       and btrim(regexp_replace(lower(d.supplier_name), '[[:space:]\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+', ' ', 'g')) = ${name}
       and not exists (select 1 from document_cancellations c where c.document_id = d.id)
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

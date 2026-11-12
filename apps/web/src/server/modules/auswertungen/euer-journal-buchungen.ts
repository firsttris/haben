import { ACCOUNTS, type JournalZeile, type Kontenrahmen, resolveOwnAccount } from "@haben/core";
import { and, asc, eq, inArray, type SQL } from "drizzle-orm";
import { schema, type Db, type Tx } from "../../db/index.ts";
import { loadOwnAccountParents } from "../eigene-konten/index.ts";

/*
 * Buchungen aus dem Journal für die EÜR (euer-journal.ts, euer-formel.ts), gesammelt geladen: Was die EÜR je Rechnung
 * bzw. Beleg braucht, kommt für alle Posten des Jahres in wenigen Abfragen statt in einigen je Posten (#542, Schritt 9).
 */

export type Zeile = Pick<JournalZeile, "account" | "debit" | "credit" | "taxCode">;

export interface Buchung {
  id: string;
  date: string;
  reversesId: string | null;
  kontenrahmen: Kontenrahmen;
  sourceType: string;
  sourceId: string;
  zeilen: Zeile[];
}

/** Höchstzahl der IDs je Abfrage mit inArray; PostgreSQL nimmt höchstens 65 535 Parameter je Abfrage */
export const BLOCK = 5000;

/** Teilt `ids` in Blöcke von höchstens BLOCK */
export function bloecke<T>(ids: T[]): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < ids.length; i += BLOCK) result.push(ids.slice(i, i + BLOCK));
  return result;
}

/** Buchungen mit ihren Zeilen, nach Datum, Anlage und ID */
export async function buchungen(q: Db | Tx, where: SQL | undefined): Promise<Buchung[]> {
  const e = schema.journalEntries;
  const l = schema.journalLines;
  const rows = await q
    .select({
      id: e.id,
      date: e.date,
      reversesId: e.reversesId,
      kontenrahmen: e.kontenrahmen,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      account: l.account,
      debit: l.debit,
      credit: l.credit,
      taxCode: l.taxCode,
    })
    .from(l)
    .innerJoin(e, eq(e.id, l.entryId))
    .where(where)
    .orderBy(asc(e.date), asc(e.createdAt), asc(e.id));
  const byId = new Map<string, Buchung>();
  for (const r of rows) {
    let b = byId.get(r.id);
    if (!b) {
      b = {
        id: r.id,
        date: r.date,
        reversesId: r.reversesId,
        kontenrahmen: r.kontenrahmen as Kontenrahmen,
        sourceType: r.sourceType,
        sourceId: r.sourceId,
        zeilen: [],
      };
      byId.set(r.id, b);
    }
    b.zeilen.push({ account: r.account, debit: r.debit, credit: r.credit, taxCode: r.taxCode });
  }
  // Bis #570 übernahm das Storno einer Bareinnahme bzw. das Aufheben einer Ausbuchung nach einem Wechsel des Kontenrahmens
  // die Kontonummern der aufgehobenen Buchung unverändert; solche Gegenbuchungen gehören zum Kontenrahmen der aufgehobenen.
  // Seitdem bucht die Gegenbuchung mit den Konten des neuen Rahmens und bleibt, wie sie ist.
  const aufgehoben = [...new Set([...byId.values()].flatMap((b) => (b.reversesId ? [b.reversesId] : [])))];
  if (aufgehoben.length > 0) {
    const original = new Map<string, { kontenrahmen: Kontenrahmen; konten: string[] }>();
    for (const block of bloecke(aufgehoben)) {
      for (const r of await q
        .select({ id: e.id, kontenrahmen: e.kontenrahmen, account: l.account })
        .from(l)
        .innerJoin(e, eq(e.id, l.entryId))
        .where(inArray(e.id, block))) {
        const o = original.get(r.id) ?? { kontenrahmen: r.kontenrahmen as Kontenrahmen, konten: [] };
        o.konten.push(r.account);
        original.set(r.id, o);
      }
    }
    const gleich = (x: string[], y: string[]) => x.length === y.length && [...x].sort().join() === [...y].sort().join();
    for (const b of byId.values()) {
      const o = b.reversesId ? original.get(b.reversesId) : undefined;
      if (
        o &&
        o.kontenrahmen !== b.kontenrahmen &&
        gleich(
          o.konten,
          b.zeilen.map((z) => z.account),
        )
      )
        b.kontenrahmen = o.kontenrahmen;
    }
  }
  // Eigene Sachkonten (#270): Die EÜR rechnet nach Kontonummer, ein eigenes Konto zählt dort wie das seiner Elternkategorie
  const eigene = new Map<Kontenrahmen, Awaited<ReturnType<typeof loadOwnAccountParents>>>();
  for (const b of byId.values()) {
    if (!eigene.has(b.kontenrahmen)) eigene.set(b.kontenrahmen, await loadOwnAccountParents(b.kontenrahmen, q));
    const parents = eigene.get(b.kontenrahmen)!;
    if (parents.size > 0) b.zeilen = b.zeilen.map((z) => ({ ...z, account: resolveOwnAccount(b.kontenrahmen, z.account, parents) }));
  }
  return [...byId.values()];
}

export const offenerPosten = (kr: Kontenrahmen, z: Zeile) => z.account === ACCOUNTS[kr].forderungen || z.account === ACCOUNTS[kr].verbindlichkeiten;

/** Fügt `b` der Liste unter `key` an */
function anhaengen<T>(map: Map<string, T[]>, key: string, b: T) {
  const liste = map.get(key);
  if (liste) liste.push(b);
  else map.set(key, [b]);
}

/**
 * Buchungen je Rechnung bzw. Beleg (Herkunft `typ`), je ID in der Reihenfolge von `buchungen`. Alle Buchungen einer ID
 * stehen im selben Block, die Reihenfolge ist deshalb dieselbe wie mit einer Abfrage je ID.
 */
export async function buchungenJe(q: Db | Tx, typ: "invoice" | "document", ids: string[]): Promise<Map<string, Buchung[]>> {
  const e = schema.journalEntries;
  const result = new Map<string, Buchung[]>();
  for (const block of bloecke([...new Set(ids)]))
    for (const b of await buchungen(q, and(eq(e.sourceType, typ), inArray(e.sourceId, block)))) anhaengen(result, b.sourceId, b);
  return result;
}

/** Zahlungen, Ausbuchungen und Bareinnahmen je Rechnung: ihre IDs, in Blöcken der Rechnungen geladen */
async function ausgleichsIds(q: Db | Tx, invoiceIds: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  for (const block of bloecke(invoiceIds)) {
    const rows = await Promise.all(
      [schema.allocations, schema.writeOffs, schema.cashEntries].map((t) =>
        q.select({ id: t.id, invoiceId: t.invoiceId }).from(t).where(inArray(t.invoiceId, block)),
      ),
    );
    for (const r of rows.flat()) if (r.invoiceId) anhaengen(result, r.invoiceId, r.id);
  }
  return result;
}

/** Fasst Rechnungen zu Gruppen mit zusammen höchstens BLOCK Ausgleichs-IDs (eine größere Rechnung bildet eine eigene) */
function gruppen(ids: Map<string, string[]>): string[][] {
  const result: string[][] = [];
  let gruppe: string[] = [];
  let anzahl = 0;
  for (const [invoiceId, quelle] of ids) {
    if (gruppe.length > 0 && anzahl + quelle.length > BLOCK) {
      result.push(gruppe);
      gruppe = [];
      anzahl = 0;
    }
    gruppe.push(invoiceId);
    anzahl += quelle.length;
  }
  if (gruppe.length > 0) result.push(gruppe);
  return result;
}

/** Position der Buchungen im Audit-Log (ID des INSERT) */
async function positionen(q: Db | Tx, ids: string[]): Promise<Map<string | null, number>> {
  const log = schema.auditLog;
  const result = new Map<string | null, number>();
  for (const block of bloecke(ids))
    for (const r of await q
      .select({ rowId: log.rowId, id: log.id })
      .from(log)
      .where(and(eq(log.tableName, "journal_entries"), eq(log.action, "INSERT"), inArray(log.rowId, block))))
      result.set(r.rowId, r.id);
  return result;
}

/**
 * Je Rechnung alle Buchungen, die sie ausgleichen (auch aus anderen Jahren), in der Reihenfolge, in der sie entstanden
 * sind: nach der Position im Audit-Log, nicht nach Datum. Danach richtet sich der gespeicherte Anteil jeder Zahlung
 * (settlementTaxShares gegen alles bis dahin Erfasste); Zahlung und Ausbuchung einer Transaktion haben dasselbe created_at.
 * Rechnungen ohne solche Buchungen fehlen in der Map.
 */
export async function ausgleichsBuchungenJe(q: Db | Tx, invoiceIds: string[]): Promise<Map<string, Buchung[]>> {
  const ids = await ausgleichsIds(q, [...new Set(invoiceIds)]);
  const rechnungVon = new Map([...ids].flatMap(([invoiceId, quelle]) => quelle.map((id): [string, string] => [id, invoiceId])));
  const gefunden = new Map<string, Buchung[]>();
  const e = schema.journalEntries;
  // Alle Ausgleiche einer Rechnung in derselben Abfrage: so bleibt ihre Reihenfolge nach Datum wie mit einer Abfrage je
  // Rechnung. Mit der Herkunft, damit der Index journal_entries_source (source_type, source_id) greift.
  for (const gruppe of gruppen(ids)) {
    const quelle = gruppe.flatMap((invoiceId) => ids.get(invoiceId)!);
    for (const b of await buchungen(q, and(inArray(e.sourceType, ["allocation", "ausbuchung", "kasse"]), inArray(e.sourceId, quelle))))
      anhaengen(gefunden, rechnungVon.get(b.sourceId)!, b);
  }
  const position = await positionen(
    q,
    [...gefunden.values()].flatMap((liste) => (liste.length < 2 ? [] : liste.map((b) => b.id))),
  );
  const result = new Map<string, Buchung[]>();
  for (const [invoiceId, liste] of gefunden) {
    if (liste.length < 2) {
      result.set(invoiceId, liste);
      continue;
    }
    // Ohne Eintrag im Audit-Log (nicht vorgesehen) bleibt die Reihenfolge nach Datum
    const index = new Map(liste.map((b, i) => [b.id, i]));
    result.set(
      invoiceId,
      [...liste].sort((a, b) => (position.get(a.id) ?? Infinity) - (position.get(b.id) ?? Infinity) || index.get(a.id)! - index.get(b.id)!),
    );
  }
  return result;
}

import {
  ACCOUNTS,
  euerAusZeilen,
  leereEuerAusJournal,
  zahlungsAnteil,
  type EuerAusJournal,
  type EuerHerkunft,
  type JournalZeile,
  type Kontenrahmen,
} from "@haben/core";
import { and, asc, eq, gte, inArray, lt, ne, type SQL } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";

/*
 * EÜR aus dem Journal (#542, Schritt 5b), als Schattenrechnung neben euerForYear. Eine Buchung ohne Forderungen und
 * Verbindlichkeiten (Bank, Kasse, privat bezahlt, Pauschale, AfA) zählt mit ihrem Datum nach ihren Konten. Eine Rechnung
 * bzw. ein Beleg auf Ziel zählt erst mit der Zahlung: Jede Zahlung, Bareinnahme oder Kursdifferenz wird anteilig auf die
 * Zeilen der Buchung verteilt, die sie ausgleicht (zahlungsAnteil). Welche das ist, sagt die Zuordnung im Nebenbuch.
 * Skonto und Forderungsausfall wirken nicht, die EÜR zählt nur, was gezahlt wird.
 */

type Zeile = Pick<JournalZeile, "account" | "debit" | "credit" | "taxCode">;

interface Buchung {
  id: string;
  kontenrahmen: Kontenrahmen;
  sourceType: string;
  sourceId: string;
  zeilen: Zeile[];
}

async function buchungen(q: Db | Tx, where: SQL | undefined): Promise<Buchung[]> {
  const e = schema.journalEntries;
  const l = schema.journalLines;
  const rows = await q
    .select({
      id: e.id,
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
      b = { id: r.id, kontenrahmen: r.kontenrahmen as Kontenrahmen, sourceType: r.sourceType, sourceId: r.sourceId, zeilen: [] };
      byId.set(r.id, b);
    }
    b.zeilen.push({ account: r.account, debit: r.debit, credit: r.credit, taxCode: r.taxCode });
  }
  return [...byId.values()];
}

const offenerPosten = (kr: Kontenrahmen, z: Zeile) => z.account === ACCOUNTS[kr].forderungen || z.account === ACCOUNTS[kr].verbindlichkeiten;
const offen = (b: Buchung) => b.zeilen.filter((z) => offenerPosten(b.kontenrahmen, z)).reduce((s, z) => s + z.debit - z.credit, 0);
const ausbuchungOhneZahlung = (b: Buchung) => {
  const a = ACCOUNTS[b.kontenrahmen];
  return b.zeilen.some((z) => z.account === a.skontiGewaehrt || z.account === a.skontiErhalten || z.account === a.forderungsverluste);
};

interface Ziel {
  invoiceId: string | null;
  documentId: string | null;
  loanId?: string | null;
}

/** Rechnung bzw. Beleg, den eine Zahlung, Ausbuchung oder Bareinnahme ausgleicht, je Herkunft der Buchung */
async function ziele(q: Db | Tx, ids: string[]): Promise<Map<string, Ziel>> {
  const result = new Map<string, Ziel>();
  if (ids.length === 0) return result;
  const a = schema.allocations;
  for (const r of await q.select({ id: a.id, invoiceId: a.invoiceId, documentId: a.documentId, loanId: a.loanId }).from(a).where(inArray(a.id, ids)))
    result.set(r.id, r);
  const w = schema.writeOffs;
  for (const r of await q.select({ id: w.id, invoiceId: w.invoiceId, documentId: w.documentId }).from(w).where(inArray(w.id, ids))) result.set(r.id, r);
  const c = schema.cashEntries;
  for (const r of await q.select({ id: c.id, invoiceId: c.invoiceId, documentId: c.documentId }).from(c).where(inArray(c.id, ids))) result.set(r.id, r);
  return result;
}

/** Alle Buchungen, die Rechnung bzw. Beleg ausgleichen (auch aus anderen Jahren), in der Reihenfolge des Buchens */
async function ausgleichsBuchungen(q: Db | Tx, invoiceId: string): Promise<Buchung[]> {
  const ids = (
    await Promise.all([
      q.select({ id: schema.allocations.id }).from(schema.allocations).where(eq(schema.allocations.invoiceId, invoiceId)),
      q.select({ id: schema.writeOffs.id }).from(schema.writeOffs).where(eq(schema.writeOffs.invoiceId, invoiceId)),
      q.select({ id: schema.cashEntries.id }).from(schema.cashEntries).where(eq(schema.cashEntries.invoiceId, invoiceId)),
    ])
  ).flatMap((rows) => rows.map((r) => r.id));
  if (ids.length === 0) return [];
  return (await buchungen(q, inArray(schema.journalEntries.sourceId, ids))).filter((b) => b.sourceType !== "invoice" && b.sourceType !== "document");
}

export interface EuerJournal {
  summe: EuerAusJournal;
  /** Zahlungen auf eine Rechnung bzw. einen Beleg ohne eigene Buchung, etwa aus Lexoffice übernommen (Eröffnungsbuchung) */
  ohneBuchung: number;
}

/** Die EÜR eines Jahres aus dem Journal: Zeilen wie computeEuer, ohne AfA und Privatnutzung, die noch nicht gebucht sind */
export async function euerAusJournal(year: number, q: Db | Tx = db): Promise<EuerJournal> {
  const e = schema.journalEntries;
  const jahr = await buchungen(q, and(gte(e.date, `${year}-01-01`), lt(e.date, `${year + 1}-01-01`), ne(e.sourceType, "eroeffnung")));
  const zielVon = await ziele(
    q,
    jahr.filter((b) => b.sourceType === "allocation" || b.sourceType === "ausbuchung" || b.sourceType === "kasse").map((b) => b.sourceId),
  );
  const loanIds = [...new Set([...zielVon.values()].flatMap((z) => (z.loanId ? [z.loanId] : [])))];
  const anlageDarlehen = new Set(
    loanIds.length === 0
      ? []
      : (
          await q
            .select({ id: schema.loans.id })
            .from(schema.loans)
            .where(and(inArray(schema.loans.id, loanIds), eq(schema.loans.purpose, "anlagevermoegen")))
        ).map((r) => r.id),
  );

  const summe = leereEuerAusJournal();
  let ohneBuchung = 0;
  // Ausgeglichene Buchung (Zeilen ohne offenen Posten, offener Posten, Herkunft) und bei Rechnungen die Ausgleiche in Reihenfolge
  const ursprung = new Map<string, { gebucht: boolean; zeilen: Zeile[]; gesamt: number; herkunft: EuerHerkunft; ausgleiche?: Buchung[] }>();
  const ursprungVon = async (kr: Kontenrahmen, typ: "invoice" | "document", id: string) => {
    const key = `${typ}|${id}`;
    if (!ursprung.has(key)) {
      const gebucht = await buchungen(q, and(eq(e.sourceType, typ), eq(e.sourceId, id)));
      const zeilen = gebucht.flatMap((b) => b.zeilen);
      let herkunft: EuerHerkunft = "sonst";
      if (typ === "document") {
        const [doc] = await q.select({ category: schema.documents.category }).from(schema.documents).where(eq(schema.documents.id, id));
        if (doc?.category === "anlage") herkunft = "anlage";
      }
      ursprung.set(key, {
        gebucht: gebucht.length > 0,
        zeilen: zeilen.filter((z) => !offenerPosten(kr, z)),
        gesamt: zeilen.filter((z) => offenerPosten(kr, z)).reduce((s, z) => s + z.debit - z.credit, 0),
        herkunft,
        ...(typ === "invoice" ? { ausgleiche: await ausgleichsBuchungen(q, id) } : {}),
      });
    }
    return ursprung.get(key)!;
  };

  for (const b of jahr) {
    const kr = b.kontenrahmen;
    const ziel = zielVon.get(b.sourceId);
    const herkunft: EuerHerkunft =
      b.sourceType === "pauschale"
        ? "pauschale"
        : b.sourceType === "asset"
          ? "asset"
          : ziel?.loanId && anlageDarlehen.has(ziel.loanId)
            ? "darlehenAnlagevermoegen"
            : "sonst";
    const ausgeglichen = offen(b);
    const hatOffenenPosten = b.zeilen.some((z) => offenerPosten(kr, z));
    // Rechnung bzw. Beleg auf Ziel: wirkt erst mit der Zahlung
    if (hatOffenenPosten && (b.sourceType === "invoice" || b.sourceType === "document" || b.sourceType === "asset")) continue;
    if (ausbuchungOhneZahlung(b)) continue;
    // Eigene Zeilen der Buchung (Kursdifferenz, Umbuchung der Umsatzsteuer, die sich aufhebt) nach ihren Konten
    euerAusZeilen(
      kr,
      b.zeilen.filter((z) => !offenerPosten(kr, z)),
      herkunft,
      summe,
    );
    if (!hatOffenenPosten || ausgeglichen === 0) continue;
    const typ = ziel?.invoiceId ? "invoice" : ziel?.documentId ? "document" : null;
    const zielId = ziel?.invoiceId ?? ziel?.documentId;
    if (!typ || !zielId) continue;
    const u = await ursprungVon(kr, typ, zielId);
    // Ohne Buchung (aus Lexoffice übernommen) fehlen Erlös und Aufwand; storniert ist nichts mehr offen
    if (!u.gebucht) ohneBuchung++;
    if (u.gesamt === 0) continue;
    // Rechnungen kumuliert wie die gespeicherten Anteile (settlementTaxShares), Belege je Zahlung (paidTaxShares)
    let bisher = 0;
    if (u.ausgleiche) {
      for (const a of u.ausgleiche) {
        if (a.id === b.id) break;
        bisher -= offen(a);
      }
    }
    euerAusZeilen(kr, zahlungsAnteil(kr, u.zeilen, u.gesamt, -ausgeglichen, bisher), u.herkunft, summe);
  }
  return { summe, ohneBuchung };
}

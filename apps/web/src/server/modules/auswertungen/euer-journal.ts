import {
  ACCOUNTS,
  computeEuer,
  euerAusZeilen,
  EXPENSE_CATEGORIES,
  leereEuerAusJournal,
  totalsFromTaxes,
  zahlungsAnteil,
  zahlungsStand,
  type EuerAusJournal,
  type EuerHerkunft,
  type AllocatedSplitLine,
  type EuerPayment,
  type ExpenseCategory,
  type JournalZeile,
  type Kontenrahmen,
} from "@haben/core";
import { and, asc, eq, gte, inArray, lt, ne, type SQL } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { splitsByDocument } from "../belege/index.ts";

/*
 * EÜR aus dem Journal (#542, Schritt 5b), als Schattenrechnung neben euerForYear. Eine Buchung ohne Forderungen und
 * Verbindlichkeiten (Bank, Kasse, privat bezahlt, Pauschale, AfA) zählt mit ihrem Datum nach ihren Konten. Eine Rechnung
 * bzw. ein Beleg auf Ziel zählt erst mit der Zahlung: Jede Zahlung, Bareinnahme oder Kursdifferenz wird anteilig auf die
 * Zeilen der Buchung verteilt, die sie ausgleicht (zahlungsAnteil). Welche das ist, sagt die Zuordnung im Nebenbuch.
 * Skonto und Forderungsausfall wirken nicht, die EÜR zählt nur, was gezahlt wird.
 */

type Zeile = Pick<JournalZeile, "account" | "debit" | "credit" | "taxCode">;

export interface Buchung {
  id: string;
  reversesId: string | null;
  kontenrahmen: Kontenrahmen;
  sourceType: string;
  sourceId: string;
  zeilen: Zeile[];
}

export async function buchungen(q: Db | Tx, where: SQL | undefined): Promise<Buchung[]> {
  const e = schema.journalEntries;
  const l = schema.journalLines;
  const rows = await q
    .select({
      id: e.id,
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
      b = { id: r.id, reversesId: r.reversesId, kontenrahmen: r.kontenrahmen as Kontenrahmen, sourceType: r.sourceType, sourceId: r.sourceId, zeilen: [] };
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
    for (const r of await q
      .select({ id: e.id, kontenrahmen: e.kontenrahmen, account: l.account })
      .from(l)
      .innerJoin(e, eq(e.id, l.entryId))
      .where(inArray(e.id, aufgehoben))) {
      const o = original.get(r.id) ?? { kontenrahmen: r.kontenrahmen as Kontenrahmen, konten: [] };
      o.konten.push(r.account);
      original.set(r.id, o);
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
  return [...byId.values()];
}

export const offenerPosten = (kr: Kontenrahmen, z: Zeile) => z.account === ACCOUNTS[kr].forderungen || z.account === ACCOUNTS[kr].verbindlichkeiten;
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

/**
 * Alle Buchungen, die eine Rechnung ausgleichen (auch aus anderen Jahren), in der Reihenfolge, in der sie entstanden sind:
 * nach der Position im Audit-Log, nicht nach Datum. Danach richtet sich der gespeicherte Anteil jeder Zahlung
 * (settlementTaxShares gegen alles bis dahin Erfasste); Zahlung und Ausbuchung einer Transaktion haben dasselbe created_at.
 */
async function ausgleichsBuchungen(q: Db | Tx, invoiceId: string): Promise<Buchung[]> {
  const ids = (
    await Promise.all([
      q.select({ id: schema.allocations.id }).from(schema.allocations).where(eq(schema.allocations.invoiceId, invoiceId)),
      q.select({ id: schema.writeOffs.id }).from(schema.writeOffs).where(eq(schema.writeOffs.invoiceId, invoiceId)),
      q.select({ id: schema.cashEntries.id }).from(schema.cashEntries).where(eq(schema.cashEntries.invoiceId, invoiceId)),
    ])
  ).flatMap((rows) => rows.map((r) => r.id));
  if (ids.length === 0) return [];
  const gefunden = (await buchungen(q, inArray(schema.journalEntries.sourceId, ids))).filter((b) => b.sourceType !== "invoice" && b.sourceType !== "document");
  if (gefunden.length < 2) return gefunden;
  const log = schema.auditLog;
  const position = new Map(
    (
      await q
        .select({ rowId: log.rowId, id: log.id })
        .from(log)
        .where(
          and(
            eq(log.tableName, "journal_entries"),
            eq(log.action, "INSERT"),
            inArray(
              log.rowId,
              gefunden.map((b) => b.id),
            ),
          ),
        )
    ).map((r) => [r.rowId, r.id]),
  );
  // Ohne Eintrag im Audit-Log (nicht vorgesehen) bleibt die Reihenfolge nach Datum
  const index = new Map(gefunden.map((b, i) => [b.id, i]));
  return [...gefunden].sort((a, b) => (position.get(a.id) ?? Infinity) - (position.get(b.id) ?? Infinity) || index.get(a.id)! - index.get(b.id)!);
}

/** Aufteilung eines Belegs aus dem Nebenbuch, für Teilzahlungen, deren Rundung die Buchung allein nicht hergibt */
export interface BelegNebenbuch {
  totals: ReturnType<typeof totalsFromTaxes>;
  category: ExpenseCategory;
  vorsteuerAbzug: boolean;
  privateShare: number;
  splits?: AllocatedSplitLine[];
}

export async function belegNebenbuch(q: Db | Tx, id: string): Promise<BelegNebenbuch | undefined> {
  const d = schema.documents;
  const [doc] = await q
    .select({ category: d.category, vorsteuerAbzug: d.vorsteuerAbzug, privateShare: d.privateShare, reverseCharge: d.reverseCharge })
    .from(d)
    .where(eq(d.id, id));
  // Nur mit Privatanteil oder ohne Vorsteuerabzug: computeEuer teilt dann erst nach Satz bzw. Zeile der Aufteilung, danach
  // privat bzw. die Steuer zu; die Buchung fasst den privaten Teil bzw. Netto und Steuer zusammen
  if (!doc || (doc.privateShare === 0 && doc.vorsteuerAbzug)) return undefined;
  const amounts = await q.select().from(schema.documentAmounts).where(eq(schema.documentAmounts.documentId, id));
  // § 13b und Erwerb: gezahlt ist nur netto, auch je Zeile der Aufteilung (wie reports.ts)
  const rows = amounts.map((a) => ({ rate: a.taxRate, base: a.net, tax: doc.reverseCharge ? 0 : a.tax }));
  const splits = (await splitsByDocument([id], q)).get(id)?.map((line) => (doc.reverseCharge ? { ...line, tax: 0 } : line));
  const category = doc.category && doc.category in EXPENSE_CATEGORIES ? (doc.category as ExpenseCategory) : "sonstiges";
  return { totals: totalsFromTaxes(rows), category, vorsteuerAbzug: doc.vorsteuerAbzug, privateShare: doc.privateShare, ...(splits ? { splits } : {}) };
}

/** Wirkung einer Teilzahlung auf einen Beleg, gerechnet wie computeEuer */
export function belegTeilzahlung(year: number, beleg: BelegNebenbuch, paid: number, summe: EuerAusJournal = leereEuerAusJournal()): EuerAusJournal {
  const payment: EuerPayment = { kind: "document", date: `${year}-06-30`, paid, ...beleg };
  const result = computeEuer(year, [payment]);
  for (const l of [...result.einnahmen, ...result.ausgaben]) if (l.amount !== 0) summe.zeilen[l.key] = (summe.zeilen[l.key] ?? 0) + l.amount;
  summe.bewirtungNichtAbziehbar += result.bewirtungNichtAbziehbar;
  return summe;
}

export interface EuerJournal {
  summe: EuerAusJournal;
  /**
   * Zahlungen auf aus Lexoffice übernommene Rechnungen und Belege: Deren Buchung steht gegen den Saldenvortrag, ohne Erlös-
   * bzw. Aufwandszeilen; die EÜR rechnet sie aus dem Nebenbuch
   */
  uebernommen: number;
}

interface Ursprung {
  uebernommen: boolean;
  /** Kontenrahmen der ausgeglichenen Buchung; er kann zum Jahreswechsel gewechselt haben */
  kontenrahmen: Kontenrahmen;
  zeilen: Zeile[];
  gesamt: number;
  herkunft: EuerHerkunft;
  /** Rechnung: Anteil jeder ausgleichenden Buchung an den Zeilen, wie gespeichert (settlementTaxShares) */
  anteile?: Map<string, number[]>;
  beleg?: BelegNebenbuch;
}

/**
 * Anteile aller Zahlungen, Ausbuchungen und Bareinnahmen einer Rechnung, wie Haben sie beim Zuordnen speichert: jede gegen
 * das bis dahin Erfasste (settlementTaxShares), eine Gegenbuchung genau umgekehrt wie die aufgehobene
 */
function rechnungsAnteile(kr: Kontenrahmen, zeilen: Zeile[], gesamt: number, ausgleiche: Buchung[]): Map<string, number[]> {
  const anteile = new Map<string, number[]>();
  let ausgeglichen = 0;
  let erfasst = zeilen.map(() => 0);
  for (const a of ausgleiche) {
    const betrag = -offen(a);
    const umgekehrt = a.reversesId ? anteile.get(a.reversesId) : undefined;
    const stand = umgekehrt ? null : zahlungsStand(kr, zeilen, gesamt, ausgeglichen + betrag);
    const anteil = umgekehrt ? umgekehrt.map((v) => -v) : stand!.map((v, i) => v - erfasst[i]!);
    erfasst = erfasst.map((v, i) => v + anteil[i]!);
    ausgeglichen += betrag;
    anteile.set(a.id, anteil);
  }
  return anteile;
}

const alsZeilen = (zeilen: Zeile[], anteil: number[]): Zeile[] =>
  zeilen.map((z, i) => ({ ...z, debit: Math.max(anteil[i]!, 0), credit: Math.max(-anteil[i]!, 0) }));

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
  let uebernommen = 0;
  const ursprung = new Map<string, Ursprung>();
  const ursprungVon = async (typ: "invoice" | "document", id: string, kr: Kontenrahmen): Promise<Ursprung> => {
    const key = `${typ}|${id}`;
    const vorhanden = ursprung.get(key);
    if (vorhanden) return vorhanden;
    const gebucht = await buchungen(q, and(eq(e.sourceType, typ), eq(e.sourceId, id)));
    const kontenrahmen = gebucht[0]?.kontenrahmen ?? kr;
    const alle = gebucht.flatMap((b) => b.zeilen);
    const zeilen = alle.filter((z) => !offenerPosten(kontenrahmen, z));
    const gesamt = alle.filter((z) => offenerPosten(kontenrahmen, z)).reduce((s, z) => s + z.debit - z.credit, 0);
    let herkunft: EuerHerkunft = "sonst";
    if (typ === "document") {
      const [doc] = await q.select({ category: schema.documents.category }).from(schema.documents).where(eq(schema.documents.id, id));
      if (doc?.category === "anlage") herkunft = "anlage";
    }
    const u: Ursprung = {
      uebernommen: gebucht.length === 0 || alle.some((z) => z.account === ACCOUNTS[kontenrahmen].saldenvortrag),
      kontenrahmen,
      zeilen,
      gesamt,
      herkunft,
      ...(typ === "invoice" && gesamt !== 0 ? { anteile: rechnungsAnteile(kontenrahmen, zeilen, gesamt, await ausgleichsBuchungen(q, id)) } : {}),
      ...(typ === "document" ? { beleg: await belegNebenbuch(q, id) } : {}),
    };
    ursprung.set(key, u);
    return u;
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
    const u = await ursprungVon(typ, zielId, kr);
    if (u.uebernommen) {
      uebernommen++;
      continue;
    }
    // Storniert: nichts mehr offen, Zahlung und Gegenbuchung heben sich auf
    if (u.gesamt === 0) continue;
    const anteil = u.anteile?.get(b.id);
    if (anteil) euerAusZeilen(u.kontenrahmen, alsZeilen(u.zeilen, anteil), u.herkunft, summe);
    // Teilzahlung auf einen Beleg mit Privatanteil oder ohne Vorsteuerabzug: gerundet wie computeEuer
    else if (u.beleg && -ausgeglichen !== u.gesamt) belegTeilzahlung(year, u.beleg, ausgeglichen, summe);
    // Beleg: jede Zahlung für sich (paidTaxShares)
    else euerAusZeilen(u.kontenrahmen, zahlungsAnteil(u.kontenrahmen, u.zeilen, u.gesamt, -ausgeglichen), u.herkunft, summe);
  }
  return { summe, uebernommen };
}

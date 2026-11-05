import { type Cents, type Kontenrahmen, lohnBuchung, lohnStornoBuchung, monatsgrenzen, monatsname } from "@haben/core";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { openBooks, post } from "../buchhaltung/index.ts";
import { LohnError } from "./employees.ts";

/*
 * Buchung der Lohnabrechnung (docs/lohn-plan.md, PR 4): Beim Festschreiben bucht Haben in derselben Transaktion Aufwand an
 * Verbindlichkeiten (lohnBuchung in @haben/core), beim Storno die Gegenbuchung. Bezahlt werden die Verbindlichkeiten im
 * Bankabgleich. Lässt sich eine Abrechnung nicht buchen, wird sie nicht festgeschrieben.
 *
 * Buchungsdatum ist der letzte Tag des abgerechneten Monats: Der Lohn ist Aufwand des Monats, für den er gezahlt wird,
 * auch wenn der Zahltag im Folgemonat liegt (Lohnzahlungszeitraum, § 38a Abs. 1 Satz 2 EStG). Die Gegenbuchung steht am
 * selben Tag wie die Buchung, damit Storno und neue Abrechnung im selben Monat liegen; der Tag des Stornos steht in
 * payslip_cancellations und im Buchungstext.
 */

type Abrechnung = typeof schema.payslips.$inferSelect;

const name = (p: Abrechnung) => `${p.mitarbeiter.vorname} ${p.mitarbeiter.nachname}`;
const deutsch = (iso: string) => iso.split("-").reverse().join(".");

/** Bucht eine festgeschriebene Abrechnung; gibt die Buchung zurück */
export async function bucheAbrechnung(tx: Tx, p: Abrechnung): Promise<string> {
  const books = await openBooks(tx);
  const r = lohnBuchung({ ...p, art: p.mitarbeiter.lohn.art }, books.kontenrahmen, books.rechtsform);
  if (!r.ok) throw new LohnError(`Die Abrechnung lässt sich nicht buchen: ${r.meldung}`);
  return post(tx, books, {
    date: monatsgrenzen(p.year, p.month).letzter,
    description: `Lohn ${monatsname(p.year, p.month)} · ${name(p)}`,
    sourceType: "lohn",
    sourceId: p.id,
    lines: r.lines,
  });
}

/** Die Buchung einer Abrechnung, die nicht selbst eine Gegenbuchung ist */
async function buchungDer(q: Db | Tx, payslipId: string) {
  const [entry] = await q
    .select()
    .from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.sourceType, "lohn"), eq(schema.journalEntries.sourceId, payslipId), isNull(schema.journalEntries.reversesId)));
  return entry ?? null;
}

/**
 * Gegenbuchung beim Storno. Eine Abrechnung, die vor der Lohnbuchung festgeschrieben wurde, hat keine Buchung; dann gibt
 * es nichts zurückzunehmen.
 */
export async function bucheStorno(tx: Tx, p: Abrechnung, stornoTag: string): Promise<void> {
  const entry = await buchungDer(tx, p.id);
  if (!entry) return;
  const lines = await tx.select().from(schema.journalLines).where(eq(schema.journalLines.entryId, entry.id));
  await post(tx, await openBooks(tx), {
    date: entry.date,
    description: `Storno vom ${deutsch(stornoTag)}: ${entry.description}`,
    sourceType: "lohn",
    sourceId: p.id,
    reversesId: entry.id,
    // Lohnbuchungen haben keinen Steuerschlüssel (lohnBuchung)
    lines: lohnStornoBuchung(lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, taxCode: null }))),
  });
}

/** Je Abrechnung, ob sie gebucht ist; für festgeschriebene ohne Buchung bietet die Seite „Buchen“ an */
export async function gebuchteAbrechnungen(ids: string[], q: Db | Tx = db): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await q
    .select({ id: schema.journalEntries.sourceId })
    .from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.sourceType, "lohn"), inArray(schema.journalEntries.sourceId, ids), isNull(schema.journalEntries.reversesId)));
  return new Set(rows.map((r) => r.id));
}

/**
 * Bucht eine Abrechnung nach, die vor der Lohnbuchung festgeschrieben wurde. Nur festgeschriebene, nicht stornierte
 * Abrechnungen ohne Buchung.
 */
export async function nachbuchen(actor: string, id: string): Promise<void> {
  await withActor(actor, async (tx) => {
    const [p] = await tx.select().from(schema.payslips).where(eq(schema.payslips.id, id)).for("update");
    if (!p) throw new LohnError("Die Abrechnung gibt es nicht.");
    if (!p.lockedAt) throw new LohnError("Ein Entwurf wird mit dem Festschreiben gebucht.");
    const [storno] = await tx.select().from(schema.payslipCancellations).where(eq(schema.payslipCancellations.payslipId, id));
    if (storno) throw new LohnError("Die Abrechnung ist storniert.");
    if (await buchungDer(tx, id)) throw new LohnError("Die Abrechnung ist schon gebucht.");
    await bucheAbrechnung(tx, p);
  });
}

/**
 * Offener Betrag einer Lohnverbindlichkeit über alle Buchungen im Kontenrahmen (Haben − Soll; negativ = überzahlt). Sperrt
 * bis zum Ende der Transaktion, damit zwei gleichzeitige Lohnzahlungen dieselbe Verbindlichkeit nicht gemeinsam überziehen.
 */
export async function offeneLohnverbindlichkeit(tx: Tx, konto: string, kontenrahmen: Kontenrahmen): Promise<Cents> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('haben.lohnzahlung'))`);
  const [row] = await tx
    .select({ offen: sql<number>`coalesce(sum(${schema.journalLines.credit} - ${schema.journalLines.debit}), 0)`.mapWith(Number) })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.journalLines.entryId))
    .where(and(eq(schema.journalLines.account, konto), eq(schema.journalEntries.kontenrahmen, kontenrahmen)));
  return row?.offen ?? 0;
}

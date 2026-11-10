import { UserError } from "../../errors.ts";
import {
  bareinnahmeText,
  CASH_BOOKINGS,
  cashEntryLabel,
  cashPosting,
  formatEuro,
  type CashBooking,
  type Cents,
  type Kontenrahmen,
  type PostingLine,
} from "@haben/core";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { openBooks, openingCash, post } from "../buchhaltung/index.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { loadCompany } from "../stammdaten/index.ts";
import { negatedShares, reverseLinesIn, reverseWriteOffRow } from "./bank.ts";

/**
 * Kassenbuch: fortlaufend nummeriert, nur anhängen, Korrektur per Storno. Der Bestand darf an keinem
 * Tag negativ werden; eine Zeile, die das bewirken würde, lehnt Haben ab. Bareinnahmen auf Rechnungen: cash-invoice.ts, ohne Rechnung: cash-income.ts.
 */

export class CashError extends UserError {}

export type CashEntry = typeof schema.cashEntries.$inferSelect;

const lock = sql`select pg_advisory_xact_lock(hashtext('haben.kasse'))`;

/**
 * Sperrt das Kassenbuch bis zum Ende der Transaktion. Wer auch Buchungen schreibt, sperrt die Kasse vorher: Jede
 * Änderung mit Audit-Eintrag nimmt die Sperre der Hash-Kette, in umgekehrter Reihenfolge blockierten sich zwei
 * Transaktionen gegenseitig.
 */
export async function lockCash(tx: Tx): Promise<void> {
  await tx.execute(lock);
}

export const cashInputSchema = z.object({
  kind: z.enum(Object.keys(CASH_BOOKINGS) as [CashBooking, ...CashBooking[]]),
  date: z.iso.date(),
  /** Cent, immer positiv; die Richtung folgt aus der Art */
  amount: z.number().int().min(1, "Betrag fehlt").max(100_000_000),
  text: z.string().trim().max(300).default(""),
});

export type CashInput = z.input<typeof cashInputSchema>;

/**
 * Bewegungen der Kasse je Tag: die Zeilen des Kassenbuchs und der Kassenbestand aus einer Eröffnung (aus dem
 * DATEV-Stapel, openingCash). Die Eröffnung hat keine eigene Zeile; sie ist der Anfangsbestand.
 */
async function cashByDay(q: Db | Tx): Promise<Map<string, Cents>> {
  const rows = await q
    .select({ date: schema.cashEntries.date, sum: sql<string>`sum(${schema.cashEntries.amount})` })
    .from(schema.cashEntries)
    .groupBy(schema.cashEntries.date);
  const days = new Map(rows.map((r) => [r.date, Number(r.sum)]));
  for (const o of await openingCash(q)) days.set(o.date, (days.get(o.date) ?? 0) + o.amount);
  return days;
}

/** Prüft, ob der Bestand mit der neuen Bewegung an jedem Tag ab ihrem Datum nicht negativ wird */
async function assertNeverNegative(tx: Tx, date: string, amount: Cents) {
  if (amount >= 0) return;
  const days = await cashByDay(tx);
  days.set(date, (days.get(date) ?? 0) + amount);
  // Bestand am Ende jedes Tages, aufsteigend
  let balance = 0;
  for (const [day, sum] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    balance += sum;
    // Erster Tag ab der neuen Bewegung, an dem der Bestand unter null fiele
    if (day >= date && balance < 0) {
      const [y, m, d] = day.split("-");
      throw new CashError(`Der Kassenbestand würde am ${d}.${m}.${y} negativ (${formatEuro(balance)}). Erfasse vorher die Einlage oder Abhebung.`);
    }
  }
}

/**
 * Prüfung für den Storno einer Eröffnung mit Kassenbestand (reverseManualEntry): sperrt das Kassenbuch und lehnt ab,
 * wenn der Bestand ohne den Eröffnungsbestand an einem Tag negativ würde.
 */
export async function checkCashReversal(tx: Tx, date: string, amount: Cents): Promise<void> {
  await tx.execute(lock);
  await assertNeverNegative(tx, date, amount);
}

export async function nextNumber(tx: Tx): Promise<number> {
  const [row] = await tx.select({ max: sql<number | null>`max(${schema.cashEntries.number})` }).from(schema.cashEntries);
  return Number(row?.max ?? 0) + 1;
}

/** Zeile für einen bar bezahlten Beleg; die Buchung „an Kasse“ macht der Beleg selbst */
export async function addDocumentCashEntry(tx: Tx, doc: { id: string; date: string; gross: Cents; text: string; journalEntryId: string }): Promise<void> {
  await tx.execute(lock);
  await assertNeverNegative(tx, doc.date, -doc.gross);
  await tx.insert(schema.cashEntries).values({
    number: await nextNumber(tx),
    date: doc.date,
    amount: -doc.gross,
    kind: "beleg",
    text: doc.text,
    documentId: doc.id,
    journalEntryId: doc.journalEntryId,
  });
}

/**
 * Gegenzeile für einen stornierten, bar bezahlten Beleg (#237): das Geld kommt rechnerisch in die Kasse zurück. Die
 * Gegenbuchung „Kasse an …“ macht der Storno des Belegs selbst; die Zeile verweist auf die ursprüngliche.
 */
export async function reverseDocumentCashEntry(tx: Tx, input: { documentId: string; date: string; text: string; journalEntryId: string }): Promise<void> {
  await tx.execute(lock);
  const [original] = await tx.select().from(schema.cashEntries).where(eq(schema.cashEntries.documentId, input.documentId));
  if (!original) throw new CashError("Zum Beleg gibt es keine Zeile im Kassenbuch.");
  // Bei einer bar erstatteten Gutschrift ist die Gegenzeile ein Ausgang; auch sie darf den Bestand nicht ins Minus bringen
  await assertNeverNegative(tx, input.date, -original.amount);
  await tx.insert(schema.cashEntries).values({
    number: await nextNumber(tx),
    date: input.date,
    amount: -original.amount,
    kind: "beleg",
    text: `${input.text} (Nr. ${original.number})`,
    reversesId: original.id,
    journalEntryId: input.journalEntryId,
  });
}

async function postCash(tx: Tx, input: { id: string; date: string; amount: Cents; kind: CashBooking; text: string; reversesId?: string | null }) {
  const books = await openBooks(tx);
  return post(tx, books, {
    date: input.date,
    description: input.text,
    sourceType: "kasse",
    sourceId: input.id,
    reversesId: input.reversesId,
    lines: cashPosting(CASH_BOOKINGS[input.kind].kind, input.amount, books.kontenrahmen, books.rechtsform),
  });
}

/** Einlage, Entnahme, Abhebung von der Bank oder Einzahlung auf die Bank */
export async function createCashEntry(actor: string, input: CashInput, today: string): Promise<CashEntry> {
  const parsed = cashInputSchema.parse(input);
  if (parsed.date > today) throw new CashError("Das Datum liegt in der Zukunft.");
  const booking = CASH_BOOKINGS[parsed.kind];
  const amount = booking.sign * parsed.amount;
  const text = parsed.text || booking.label;
  return withActor(actor, async (tx) => {
    await tx.execute(lock);
    await assertNeverNegative(tx, parsed.date, amount);
    const id = crypto.randomUUID();
    const journalEntryId = await postCash(tx, { id, date: parsed.date, amount, kind: parsed.kind, text });
    const [row] = await tx
      .insert(schema.cashEntries)
      .values({ id, number: await nextNumber(tx), date: parsed.date, amount, kind: parsed.kind, text, journalEntryId })
      .returning();
    return row!;
  });
}

/**
 * Storno einer Zeile ohne Beleg: Gegenzeile mit heutigem Datum und Gegenbuchung. Bei einer Bareinnahme auf eine Rechnung
 * ist die Rechnung danach wieder offen (reverseBookedCashEntry).
 */
export async function reverseCashEntry(actor: string, id: string, today: string): Promise<CashEntry> {
  return withActor(actor, async (tx) => {
    await tx.execute(lock);
    const [original] = await tx.select().from(schema.cashEntries).where(eq(schema.cashEntries.id, id));
    if (!original || original.reversesId) throw new CashError("Kassenbuchung nicht gefunden.");
    if (original.kind === "beleg") throw new CashError("Bar bezahlte Belege sind gebucht und lassen sich hier nicht stornieren.");
    const [already] = await tx.select({ id: schema.cashEntries.id }).from(schema.cashEntries).where(eq(schema.cashEntries.reversesId, id));
    if (already) throw new CashError("Die Kassenbuchung ist bereits storniert.");
    const date = today < original.date ? original.date : today;
    await assertNeverNegative(tx, date, -original.amount);
    if (original.kind === "rechnung" || original.kind === "einnahme") return reverseBookedCashEntry(tx, original, date);
    const reversalId = crypto.randomUUID();
    const text = `Storno Nr. ${original.number}: ${original.text}`;
    const journalEntryId = await postCash(tx, {
      id: reversalId,
      date,
      amount: -original.amount,
      kind: original.kind as CashBooking,
      text,
      reversesId: original.journalEntryId,
    });
    const [row] = await tx
      .insert(schema.cashEntries)
      .values({
        id: reversalId,
        number: await nextNumber(tx),
        date,
        amount: -original.amount,
        kind: original.kind,
        text,
        reversesId: original.id,
        journalEntryId,
      })
      .returning();
    return row!;
  });
}

/**
 * Gegenzeile einer Bareinnahme auf eine Rechnung oder ohne Rechnung (GoBD: nichts wird überschrieben): Die Gegenbuchung
 * dreht die Zeilen der ursprünglichen Buchung (Forderungen an Kasse, bei Ist auch die Umsatzsteuer zurück auf „nicht fällig“), der
 * Steueranteil geht genau zurück. Ein mit der Bareinnahme als Skonto ausgebuchter Rest wird am selben Tag mit aufgehoben,
 * wie beim Aufheben einer Zuordnung im Bankabgleich; ohne die Zahlung wäre er falsch.
 */
async function reverseBookedCashEntry(tx: Tx, original: CashEntry, date: string): Promise<CashEntry> {
  if (!original.journalEntryId) throw new CashError("Zur Bareinnahme gibt es keine Buchung.");
  const reversalId = crypto.randomUUID();
  const text = `Storno Nr. ${original.number}: ${original.text}`;
  const lines = await tx.select().from(schema.journalLines).where(eq(schema.journalLines.entryId, original.journalEntryId));
  const [entry] = await tx
    .select({ kontenrahmen: schema.journalEntries.kontenrahmen })
    .from(schema.journalEntries)
    .where(eq(schema.journalEntries.id, original.journalEntryId));
  const books = await openBooks(tx);
  const journalEntryId = await post(tx, books, {
    date,
    description: text,
    sourceType: "kasse",
    sourceId: reversalId,
    reversesId: original.journalEntryId,
    // Nach einem Wechsel des Kontenrahmens mit den Konten derselben Rolle im neuen Rahmen
    lines: reverseLinesIn(
      (entry?.kontenrahmen ?? books.kontenrahmen) as Kontenrahmen,
      books.kontenrahmen,
      lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, taxCode: l.taxCode as PostingLine["taxCode"], basis: l.basis })),
    ),
  });
  const [row] = await tx
    .insert(schema.cashEntries)
    .values({
      id: reversalId,
      number: await nextNumber(tx),
      date,
      amount: -original.amount,
      kind: original.kind,
      text,
      invoiceId: original.invoiceId,
      // Ohne Rechnung (#276): dieselbe Behandlung, damit Voranmeldung und EÜR den Storno wie die Einnahme zuordnen
      taxTreatment: original.taxTreatment,
      taxRate: original.taxRate,
      taxShares: negatedShares(original.taxShares),
      taxSharesInvoiceId: original.taxSharesInvoiceId,
      reversesId: original.id,
      journalEntryId,
    })
    .returning();
  const linked = await tx
    .select()
    .from(schema.writeOffs)
    .where(and(eq(schema.writeOffs.cashEntryId, original.id), isNull(schema.writeOffs.reversesId)))
    .for("update");
  for (const writeOff of linked) await reverseWriteOffRow(tx, writeOff, date);
  return row!;
}

/** Kassenbuch eines Jahres mit Anfangsbestand und Bestand nach jeder Zeile */
export async function cashBook(year: number) {
  const rows = await db
    .select({
      id: schema.cashEntries.id,
      number: schema.cashEntries.number,
      date: schema.cashEntries.date,
      amount: schema.cashEntries.amount,
      kind: schema.cashEntries.kind,
      text: schema.cashEntries.text,
      documentId: schema.cashEntries.documentId,
      invoiceId: schema.cashEntries.invoiceId,
      invoiceNumber: schema.invoices.number,
      taxTreatment: schema.cashEntries.taxTreatment,
      taxRate: schema.cashEntries.taxRate,
      reversesId: schema.cashEntries.reversesId,
    })
    .from(schema.cashEntries)
    .leftJoin(schema.invoices, eq(schema.invoices.id, schema.cashEntries.invoiceId))
    .orderBy(asc(schema.cashEntries.date), asc(schema.cashEntries.number));
  const start = `${year}-01-01`;
  const end = `${year + 1}-01-01`;
  // Eröffnungsbestand aus dem Journal (Eröffnung am 1. Januar) gehört zum Anfangsbestand seines Jahres
  const openings = await openingCash();
  const openingUntil = (date: string) => openings.filter((o) => o.date <= date).reduce((s, o) => s + o.amount, 0);
  const opening = rows.filter((r) => r.date < start).reduce((s, r) => s + r.amount, 0) + openingUntil(start);
  const reversed = new Set(rows.flatMap((r) => (r.reversesId ? [r.reversesId] : [])));
  let balance = opening;
  const entries = rows
    .filter((r) => r.date >= start && r.date < end)
    .map((r) => {
      balance += r.amount;
      return { ...r, balance, reversed: reversed.has(r.id) };
    });
  const { rechtsform } = await loadCompany();
  const current = rows.reduce((s, r) => s + r.amount, 0) + openingUntil("9999-12-31");
  return { year, rechtsform, opening, closing: balance, current, entries };
}

/** Gequotetes Textfeld; beginnt es mit = + - @, wird ein ' vorangestellt, damit Excel es nicht als Formel ausführt */
const csvText = (value: string) => `"${(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value).replace(/"/g, '""')}"`;
const csvAmount = (cents: Cents) => (cents / 100).toFixed(2).replace(".", ",");

/** Kassenbuch als CSV (Semikolon, Dezimalkomma, UTF-8 mit BOM), wie die übrigen Exporte */
export async function cashBookCsv(year: number): Promise<string> {
  const book = await cashBook(year);
  const lines = [
    ["Nr.", "Datum", "Art", "Text", "Einnahme", "Ausgabe", "Bestand", "Beleg-ID", "Storno von", "Rechnung", "Steuer"].map(csvText).join(";"),
    [
      csvText(""),
      csvText(`${year}-01-01`),
      csvText("Anfangsbestand"),
      csvText(""),
      "",
      "",
      csvAmount(book.opening),
      csvText(""),
      csvText(""),
      csvText(""),
      csvText(""),
    ].join(";"),
    ...book.entries.map((e) =>
      [
        String(e.number),
        csvText(e.date),
        csvText(cashEntryLabel(e.kind, book.rechtsform)),
        csvText(e.text),
        e.amount > 0 ? csvAmount(e.amount) : "",
        e.amount < 0 ? csvAmount(-e.amount) : "",
        csvAmount(e.balance),
        csvText(e.documentId ?? ""),
        csvText(e.reversesId ?? ""),
        csvText(e.invoiceNumber ?? ""),
        csvText(e.taxTreatment && e.taxRate !== null ? bareinnahmeText({ behandlung: e.taxTreatment, steuersatz: e.taxRate }) : ""),
      ].join(";"),
    ),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

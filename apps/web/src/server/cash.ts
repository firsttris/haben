import { UserError } from "./errors.ts";
import { CASH_BOOKINGS, cashPosting, formatEuro, type CashBooking, type Cents } from "@haben/core";
import { asc, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { loadCompany } from "./company.ts";
import { withActor } from "./db/actor.ts";
import { db, schema, type Tx } from "./db/index.ts";

/**
 * Kassenbuch: fortlaufend nummeriert, nur anhängen, Korrektur per Storno. Der Bestand darf an keinem
 * Tag negativ werden; eine Zeile, die das bewirken würde, lehnt Haben ab.
 */

export class CashError extends UserError {}

export type CashEntry = typeof schema.cashEntries.$inferSelect;

const lock = sql`select pg_advisory_xact_lock(hashtext('haben.kasse'))`;

export const cashInputSchema = z.object({
  kind: z.enum(Object.keys(CASH_BOOKINGS) as [CashBooking, ...CashBooking[]]),
  date: z.iso.date(),
  /** Cent, immer positiv; die Richtung folgt aus der Art */
  amount: z.number().int().min(1, "Betrag fehlt").max(100_000_000),
  text: z.string().trim().max(300).default(""),
});

export type CashInput = z.input<typeof cashInputSchema>;

/** Prüft, ob der Bestand mit der neuen Zeile an jedem Tag ab ihrem Datum nicht negativ wird */
async function assertNeverNegative(tx: Tx, date: string, amount: Cents) {
  if (amount >= 0) return;
  const [before] = await tx
    .select({ sum: sql<string>`coalesce(sum(${schema.cashEntries.amount}), 0)` })
    .from(schema.cashEntries)
    .where(lt(schema.cashEntries.date, date));
  const days = await tx
    .select({ date: schema.cashEntries.date, sum: sql<string>`sum(${schema.cashEntries.amount})` })
    .from(schema.cashEntries)
    .where(gte(schema.cashEntries.date, date))
    .groupBy(schema.cashEntries.date)
    .orderBy(asc(schema.cashEntries.date));
  // Bestand am Ende jedes Tages ab dem Datum der neuen Zeile
  let balance = Number(before?.sum ?? 0) + amount;
  if (days[0]?.date !== date) days.unshift({ date, sum: "0" });
  for (const day of days) {
    balance += Number(day.sum);
    // Erster Tag, an dem der Bestand unter null fiele
    if (balance < 0) {
      const [y, m, d] = day.date.split("-");
      throw new CashError(`Der Kassenbestand würde am ${d}.${m}.${y} negativ (${formatEuro(balance)}). Erfasse vorher die Einlage oder Abhebung.`);
    }
  }
}

async function nextNumber(tx: Tx): Promise<number> {
  const [row] = await tx.select({ max: sql<number | null>`max(${schema.cashEntries.number})` }).from(schema.cashEntries);
  return Number(row?.max ?? 0) + 1;
}

/** Zeile für einen bar bezahlten Beleg; die Buchung „an Kasse“ macht der Beleg selbst */
export async function addDocumentCashEntry(
  tx: Tx,
  doc: { id: string; date: string; gross: Cents; text: string; journalEntryId: string },
): Promise<void> {
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

async function postCash(tx: Tx, input: { id: string; date: string; amount: Cents; kind: CashBooking; text: string; reversesId?: string | null }) {
  const { kontenrahmen } = await loadCompany();
  const [entry] = await tx
    .insert(schema.journalEntries)
    .values({ date: input.date, description: input.text, sourceType: "kasse", sourceId: input.id, kontenrahmen, reversesId: input.reversesId ?? null })
    .returning();
  await tx.insert(schema.journalLines).values(cashPosting(CASH_BOOKINGS[input.kind].kind, input.amount, kontenrahmen).map((line) => ({ entryId: entry!.id, ...line })));
  await tx.update(schema.journalEntries).set({ lockedAt: new Date() }).where(eq(schema.journalEntries.id, entry!.id));
  return entry!.id;
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

/** Storno einer Zeile ohne Beleg: Gegenzeile mit heutigem Datum und Gegenbuchung */
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
      .values({ id: reversalId, number: await nextNumber(tx), date, amount: -original.amount, kind: original.kind, text, reversesId: original.id, journalEntryId })
      .returning();
    return row!;
  });
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
      reversesId: schema.cashEntries.reversesId,
    })
    .from(schema.cashEntries)
    .orderBy(asc(schema.cashEntries.date), asc(schema.cashEntries.number));
  const start = `${year}-01-01`;
  const end = `${year + 1}-01-01`;
  const opening = rows.filter((r) => r.date < start).reduce((s, r) => s + r.amount, 0);
  const reversed = new Set(rows.flatMap((r) => (r.reversesId ? [r.reversesId] : [])));
  let balance = opening;
  const entries = rows
    .filter((r) => r.date >= start && r.date < end)
    .map((r) => {
      balance += r.amount;
      return { ...r, balance, reversed: reversed.has(r.id) };
    });
  return { year, opening, closing: balance, current: rows.reduce((s, r) => s + r.amount, 0), entries };
}

/** Gequotetes Textfeld; beginnt es mit = + - @, wird ein ' vorangestellt, damit Excel es nicht als Formel ausführt */
const csvText = (value: string) => `"${(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value).replace(/"/g, '""')}"`;
const csvAmount = (cents: Cents) => (cents / 100).toFixed(2).replace(".", ",");

/** Kassenbuch als CSV (Semikolon, Dezimalkomma, UTF-8 mit BOM), wie die übrigen Exporte */
export async function cashBookCsv(year: number): Promise<string> {
  const book = await cashBook(year);
  const lines = [
    ["Nr.", "Datum", "Art", "Text", "Einnahme", "Ausgabe", "Bestand", "Beleg-ID", "Storno von"].map(csvText).join(";"),
    [csvText(""), csvText(`${year}-01-01`), csvText("Anfangsbestand"), csvText(""), "", "", csvAmount(book.opening), csvText(""), csvText("")].join(";"),
    ...book.entries.map((e) =>
      [
        String(e.number),
        csvText(e.date),
        csvText(e.kind === "beleg" ? "Beleg" : CASH_BOOKINGS[e.kind].label),
        csvText(e.text),
        e.amount > 0 ? csvAmount(e.amount) : "",
        e.amount < 0 ? csvAmount(-e.amount) : "",
        csvAmount(e.balance),
        csvText(e.documentId ?? ""),
        csvText(e.reversesId ?? ""),
      ].join(";"),
    ),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

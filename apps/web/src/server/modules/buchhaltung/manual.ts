import { isKapitalgesellschaft, manualPosting, manualPostingIssues, MANUAL_MAX_LINES, reverseManualPosting } from "@haben/core";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { schema, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { openBooks, post } from "./ledger.ts";

/*
 * Manuelle Buchungen (Umbuchungen) für GmbH und UG. Sie haben keine eigene Tabelle: Die Buchung im Journal ist schon
 * festgeschrieben und versiegelt, die Herkunft „manuell“ und ihre eigene ID als sourceId genügen. Korrigiert wird per
 * Gegenbuchung (reversesId) wie überall im Hauptbuch.
 */

export class ManualEntryError extends UserError {}

const cents = z.number().int().min(0).max(100_000_000_00);

export const manualEntrySchema = z.object({
  date: z.iso.date(),
  /** Buchungstext; bei einer Umbuchung ohne fremden Beleg ist er der Eigenbeleg */
  description: z.string().trim().min(3, "Buchungstext fehlt").max(300),
  lines: z
    .array(z.object({ account: z.string().trim(), debit: cents, credit: cents }))
    .min(2)
    .max(MANUAL_MAX_LINES),
});

export type ManualEntryInput = z.input<typeof manualEntrySchema>;

/**
 * Bucht eine manuelle Buchung. Nur in GmbH und UG: Im Einzelunternehmen rechnet die EÜR aus Rechnungen, Belegen und
 * Zahlungen, eine Umbuchung im Journal käme dort nie an.
 */
export async function createManualEntry(actor: string, input: ManualEntryInput, today: string): Promise<string> {
  const parsed = manualEntrySchema.parse(input);
  if (parsed.date > today) throw new ManualEntryError("Das Datum liegt in der Zukunft.");
  return withActor(actor, async (tx) => {
    const books = await openBooks(tx);
    if (!isKapitalgesellschaft(books.rechtsform)) {
      throw new ManualEntryError("Manuelle Buchungen gibt es nur für GmbH und UG; im Einzelunternehmen rechnet die EÜR aus Rechnungen und Belegen.");
    }
    const issues = manualPostingIssues(parsed.lines, books.kontenrahmen, books.rechtsform);
    if (issues.length > 0) throw new ManualEntryError(`${issues.join(". ")}.`);
    return post(tx, books, {
      date: parsed.date,
      description: parsed.description,
      sourceType: "manuell",
      sourceId: crypto.randomUUID(),
      lines: manualPosting(parsed.lines),
    });
  });
}

/** Die manuelle Buchung, gesperrt bis zum Ende der Transaktion: zwei gleichzeitige Stornos sehen einander */
async function lockedManualEntry(tx: Tx, entryId: string) {
  const [entry] = await tx
    .select()
    .from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.id, entryId), eq(schema.journalEntries.sourceType, "manuell")))
    .for("update");
  if (!entry) throw new ManualEntryError("Manuelle Buchung nicht gefunden.");
  if (entry.reversesId) throw new ManualEntryError("Eine Gegenbuchung lässt sich nicht stornieren.");
  const [already] = await tx.select({ id: schema.journalEntries.id }).from(schema.journalEntries).where(eq(schema.journalEntries.reversesId, entryId));
  if (already) throw new ManualEntryError("Die Buchung ist bereits storniert.");
  return entry;
}

/**
 * Storniert eine manuelle Buchung mit einer Gegenbuchung am selben Tag, damit sie im selben Zeitraum aufgeht.
 * Liegt der Tag in einem Jahr mit anderem Kontenrahmen, lehnt das Hauptbuch ab.
 */
export async function reverseManualEntry(actor: string, entryId: string): Promise<string> {
  return withActor(actor, async (tx) => {
    const entry = await lockedManualEntry(tx, entryId);
    const books = await openBooks(tx);
    const lines = await tx
      .select({
        account: schema.journalLines.account,
        debit: schema.journalLines.debit,
        credit: schema.journalLines.credit,
        taxCode: schema.journalLines.taxCode,
      })
      .from(schema.journalLines)
      .where(eq(schema.journalLines.entryId, entryId))
      .orderBy(asc(schema.journalLines.id));
    return post(tx, books, {
      date: entry.date,
      description: `Storno: ${entry.description}`,
      sourceType: "manuell",
      sourceId: entry.sourceId,
      reversesId: entry.id,
      lines: reverseManualPosting(lines.map((l) => ({ ...l, taxCode: null }))),
    });
  });
}

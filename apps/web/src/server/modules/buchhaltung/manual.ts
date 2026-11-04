import { ACCOUNTS, isKapitalgesellschaft, manualPosting, manualPostingIssues, MANUAL_MAX_LINES, reverseManualPosting } from "@haben/core";
import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { schema, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { activeOpenings } from "./eroeffnung.ts";
import { openBooks, post } from "./ledger.ts";

/*
 * Manuelle Buchungen (Umbuchungen) für GmbH und UG. Sie haben keine eigene Tabelle: Die Buchung im Journal ist schon
 * festgeschrieben und versiegelt, die Herkunft „manuell“ und ihre eigene ID als sourceId genügen. Korrigiert wird per
 * Gegenbuchung (reversesId) wie überall im Hauptbuch.
 */

export class ManualEntryError extends UserError {}

const cents = z.number().int().min(0).max(100_000_000_00);

export const manualEntrySchema = z.object({
  /** Umbuchung oder Eröffnungsbuchung (Saldenvortrag aus der bisherigen Buchhaltung), siehe ManualKind in @haben/core */
  kind: z.enum(["umbuchung", "eroeffnung"]).default("umbuchung"),
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
    const issues = manualPostingIssues(parsed.lines, books.kontenrahmen, books.rechtsform, parsed.kind);
    if (parsed.kind === "eroeffnung") issues.push(...(await openingIssues(tx, parsed.date)));
    if (issues.length > 0) throw new ManualEntryError(`${issues.join(". ")}.`);
    return post(tx, books, {
      date: parsed.date,
      description: parsed.description,
      sourceType: parsed.kind === "eroeffnung" ? "eroeffnung" : "manuell",
      sourceId: crypto.randomUUID(),
      lines: manualPosting(parsed.lines),
    });
  });
}

/**
 * Eine Eröffnung steht am 1. Januar des ersten Jahres in Haben: Davor darf es keine Buchung geben, sonst trägt Haben die
 * Salden selbst vor (Saldenvortrag in der Saldenliste) und die Eröffnung zählte doppelt.
 */
async function openingIssues(tx: Tx, date: string): Promise<string[]> {
  if (!date.endsWith("-01-01")) return ["Eine Eröffnungsbuchung steht am 1. Januar"];
  const [earlier] = await tx.select({ id: schema.journalEntries.id }).from(schema.journalEntries).where(lt(schema.journalEntries.date, date)).limit(1);
  if (earlier) return [`Vor dem ${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)} gibt es schon Buchungen; ihre Salden trägt Haben selbst vor`];
  // Die Eröffnung aus dem Stapel bringt alle Bestände der Schlussbilanz mit; eine weitere zählte sie doppelt
  const stapel = (await activeOpenings(tx)).find((o) => o.ausStapel);
  return stapel ? ["Die Eröffnung aus dem DATEV-Stapel enthält schon alle Bestände; für eine Änderung sie stornieren und neu eröffnen"] : [];
}

/** Die manuelle Buchung, gesperrt bis zum Ende der Transaktion: zwei gleichzeitige Stornos sehen einander */
async function lockedManualEntry(tx: Tx, entryId: string) {
  const [entry] = await tx
    .select()
    .from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.id, entryId), inArray(schema.journalEntries.sourceType, ["manuell", "eroeffnung"])))
    .for("update");
  if (!entry) throw new ManualEntryError("Manuelle Buchung nicht gefunden.");
  if (entry.reversesId) throw new ManualEntryError("Eine Gegenbuchung lässt sich nicht stornieren.");
  const [already] = await tx.select({ id: schema.journalEntries.id }).from(schema.journalEntries).where(eq(schema.journalEntries.reversesId, entryId));
  if (already) throw new ManualEntryError("Die Buchung ist bereits storniert.");
  return entry;
}

/**
 * Prüfung vor dem Storno einer Eröffnung, die die Kasse bebucht (aus dem DATEV-Stapel): Das Kassenbuch zählt den
 * Bestand zum Anfangsbestand. Das Kassenbuch führt das Modul Bank und Kasse; es reicht die Prüfung herein.
 */
export type CashReversalCheck = (tx: Tx, date: string, amount: number) => Promise<void>;

/**
 * Storniert eine manuelle Buchung mit einer Gegenbuchung am selben Tag, damit sie im selben Zeitraum aufgeht.
 * Liegt der Tag in einem Jahr mit anderem Kontenrahmen, lehnt das Hauptbuch ab. Bebucht sie die Kasse, prüft
 * `checkCash`, dass der Kassenbestand ohne sie an keinem Tag negativ wird; ohne Prüfung wird sie nicht storniert.
 */
export async function reverseManualEntry(actor: string, entryId: string, checkCash?: CashReversalCheck): Promise<string> {
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
    const kasse = lines.filter((l) => l.account === ACCOUNTS[entry.kontenrahmen].kasse).reduce((sum, l) => sum + l.debit - l.credit, 0);
    if (kasse !== 0) {
      if (!checkCash) throw new ManualEntryError("Die Buchung bebucht die Kasse; der Storno braucht die Prüfung des Kassenbuchs.");
      await checkCash(tx, entry.date, -kasse);
    }
    return post(tx, books, {
      date: entry.date,
      description: `Storno: ${entry.description}`,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      reversesId: entry.id,
      lines: reverseManualPosting(lines.map((l) => ({ ...l, taxCode: null }))),
    });
  });
}

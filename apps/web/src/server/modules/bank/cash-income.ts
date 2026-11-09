import { BAREINNAHME_BEHANDLUNG_KEYS, bareinnahmeFehler, bareinnahmePosting, bareinnahmeText, type BareinnahmeAngabe } from "@haben/core";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { schema } from "../../db/index.ts";
import { openBooks, post } from "../buchhaltung/index.ts";
import { kleinunternehmerForMonth } from "../stammdaten/index.ts";
import { CashError, lockCash, nextNumber, type CashEntry } from "./cash.ts";

/*
 * Bareinnahme ohne Rechnung im Kassenbuch (#276), etwa die Tagessumme eines Marktstands: Kasse an Erlöse mit der
 * Steuerbehandlung am Tag der Bareinnahme (packages/core/src/bareinnahme.ts). Storno über reverseCashEntry (cash.ts).
 */

export const cashIncomeInputSchema = z.object({
  date: z.iso.date(),
  /** Cent, immer positiv: Geld kommt in die Kasse */
  amount: z.number().int().min(1, "Betrag fehlt").max(100_000_000),
  /** Pflicht: Ohne Rechnung ist die Notiz der Nachweis, etwa „Weihnachtsmarkt 28.11., Tagessumme“ */
  text: z.string().trim().min(1, "Notiz fehlt: Wofür ist die Einnahme?").max(300),
  steuer: z.object({
    behandlung: z.enum(BAREINNAHME_BEHANDLUNG_KEYS),
    steuersatz: z.number().int().min(0).max(10_000),
  }),
});

export type CashIncomeInput = z.input<typeof cashIncomeInputSchema>;

/** Bareinnahme ohne Rechnung buchen: fortlaufende Nummer, Buchung am Tag der Bareinnahme */
export async function createCashIncome(actor: string, input: CashIncomeInput, today: string): Promise<CashEntry> {
  const parsed = cashIncomeInputSchema.parse(input);
  if (parsed.date > today) throw new CashError("Das Datum liegt in der Zukunft.");
  const angabe: BareinnahmeAngabe = parsed.steuer;
  return withActor(actor, async (tx) => {
    // Erst die Kasse, dann die Buchungen sperren (lockCash)
    await lockCash(tx);
    const books = await openBooks(tx);
    // Stand am Ende des Monats der Bareinnahme, wie die Voranmeldung ihn liest (computeVatFigures)
    const kleinunternehmer = await kleinunternehmerForMonth(Number(parsed.date.slice(0, 4)), Number(parsed.date.slice(5, 7)), tx);
    const fehler = bareinnahmeFehler(angabe, kleinunternehmer);
    if (fehler) throw new CashError(fehler);
    const id = crypto.randomUUID();
    const journalEntryId = await post(tx, books, {
      date: parsed.date,
      description: `${parsed.text} · ${bareinnahmeText(angabe)}`,
      sourceType: "kasse",
      sourceId: id,
      lines: bareinnahmePosting(angabe, parsed.amount, books.kontenrahmen),
    });
    const [row] = await tx
      .insert(schema.cashEntries)
      .values({
        id,
        number: await nextNumber(tx),
        date: parsed.date,
        amount: parsed.amount,
        kind: "einnahme",
        text: parsed.text,
        taxTreatment: angabe.behandlung,
        taxRate: angabe.steuersatz,
        journalEntryId,
      })
      .returning();
    return row!;
  });
}

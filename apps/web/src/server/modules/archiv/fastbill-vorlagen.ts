import { FastbillApiError, type FastbillClient, type FbRecurring, mapFbRecurring } from "@haben/import";
import { eq } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import type { LexofficeImportProgress } from "../../db/schema.ts";
import { UserError } from "../../errors.ts";
import { importRecurringPaused } from "../rechnungen/index.ts";
import { loadCompany } from "../stammdaten/index.ts";
import { progressMessage } from "./lexoffice.ts";

/*
 * Vorlagen wiederkehrender Rechnungen aus FastBill (recurring.get), wie die aus sevDesk (sevdesk-vorlagen.ts): Jede
 * kommt pausiert als wiederkehrende Rechnung an, die Antwort ohne Bankdaten und die Hinweise stehen daneben in
 * fastbill_recurring_templates. Schon übernommene Vorlagen überspringt ein neuer Abruf, auch wenn sie in Haben gelöscht
 * wurden. Was Haben nicht abbilden kann (Turnus in Wochen, Rabatt, Fremdwährung …), steht je Vorlage in progress.failed.
 */

class TemplateError extends UserError {}

/** Bankdaten des Kunden gehören nicht in den Nachweis */
const BANK_FIELDS = ["BANK_NAME", "BANK_ACCOUNT_NUMBER", "BANK_CODE", "BANK_ACCOUNT_OWNER", "BANK_IBAN", "BANK_BIC"];

function withoutBankData(raw: FbRecurring): Record<string, unknown> {
  return Object.fromEntries(Object.entries(raw).filter(([k]) => !BANK_FIELDS.includes(k)));
}

const fatal = (error: unknown, signal: AbortSignal) =>
  signal.aborted ||
  (error instanceof Error && error.name === "AbortError") ||
  (error instanceof FastbillApiError && (error.status === 401 || error.status === 403));

export async function importFastbillRecurring(
  actor: string,
  importId: string,
  client: FastbillClient,
  progress: LexofficeImportProgress,
  signal: AbortSignal,
): Promise<void> {
  const known = new Set((await db.select({ id: schema.fastbillRecurringTemplates.fastbillId }).from(schema.fastbillRecurringTemplates)).map((r) => r.id));
  const result = { imported: 0, known: 0 };
  progress.fastbillRecurring = result;
  const paymentTermDays = (await loadCompany())?.paymentTermDays ?? 14;
  try {
    for await (const raw of client.recurring()) {
      const id = String(raw.INVOICE_ID);
      if (known.has(id)) {
        result.known += 1;
        continue;
      }
      try {
        if (await importOne(actor, importId, raw, paymentTermDays)) result.imported += 1;
        else result.known += 1;
      } catch (error) {
        if (fatal(error, signal)) throw error;
        progress.failed.push({
          lexofficeId: `fastbill/recurring/${id}`,
          number: raw.INVOICE_TITLE?.trim() || `Vorlage ${id}`,
          message: `Wiederkehrende Rechnung nicht übernommen: ${progressMessage(error)}`,
        });
      }
    }
  } catch (error) {
    if (fatal(error, signal)) throw error;
    progress.failed.push({ lexofficeId: "fastbill/recurring", number: "Wiederkehrende Rechnungen", message: progressMessage(error) });
  }
}

async function importOne(actor: string, importId: string, raw: FbRecurring, paymentTermDays: number): Promise<boolean> {
  const mapped = mapFbRecurring(raw);
  if (!mapped.ok) throw new TemplateError(mapped.reason);
  return withActor(actor, async (tx) => {
    const [contact] = mapped.customerId
      ? await tx.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.fastbillId, mapped.customerId))
      : [];
    if (!contact) throw new TemplateError("Der Kunde der Vorlage ist nicht übernommen.");
    // Zuerst der Nachweis: ein gleichzeitiger Lauf mit derselben Vorlage scheitert an der eindeutigen fastbill_id
    const [link] = await tx
      .insert(schema.fastbillRecurringTemplates)
      .values({ fastbillId: String(raw.INVOICE_ID), importId, hints: mapped.hints, raw: withoutBankData(raw) })
      .onConflictDoNothing({ target: schema.fastbillRecurringTemplates.fastbillId })
      .returning({ id: schema.fastbillRecurringTemplates.id });
    if (!link) return false;
    const { anchorDay, intervalMonths, ...template } = mapped.template;
    const recurringId = await importRecurringPaused(tx, { ...template, paymentTermDays, contactId: contact.id, intervalMonths, anchorDay });
    await tx.update(schema.fastbillRecurringTemplates).set({ recurringId }).where(eq(schema.fastbillRecurringTemplates.id, link.id));
    return true;
  });
}

/** Herkunft einer wiederkehrenden Rechnung aus FastBill für ihre Seite; null, wenn sie nicht aus FastBill kommt */
export async function fastbillRecurringOrigin(recurringId: string) {
  const [row] = await db
    .select({
      fastbillId: schema.fastbillRecurringTemplates.fastbillId,
      hints: schema.fastbillRecurringTemplates.hints,
      createdAt: schema.fastbillRecurringTemplates.createdAt,
    })
    .from(schema.fastbillRecurringTemplates)
    .where(eq(schema.fastbillRecurringTemplates.recurringId, recurringId));
  return row ?? null;
}

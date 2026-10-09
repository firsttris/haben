import { INTERNAL_ERROR, isUniqueViolation, UserError, userMessage } from "./errors.ts";
import {
  addMonthsAnchored,
  dueDates,
  fillPlaceholders,
  invoiceLineInputSchema,
  servicePeriodFor,
  TAX_TREATMENT_KEYS,
  type RecurringInterval,
  type ServicePeriodMode,
  type UnitLabel,
} from "@haben/core";
import { and, asc, desc, eq, lte } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "./db/actor.ts";
import { db, schema } from "./db/index.ts";
import { createDraft, finalizeInvoice } from "./invoices.ts";
import { sendInvoiceMailWithTemplate } from "./invoice-mail.ts";
import { MailError } from "./mail.ts";

export type RecurringInvoice = typeof schema.recurringInvoices.$inferSelect;

export class RecurringError extends UserError {}

/** Wer die Rechnungen eines Laufs im Audit-Log angelegt hat */
export const RECURRING_ACTOR = "system:wiederkehrend";

const isoDate = z.iso.date();

export const recurringInputSchema = z.object({
  name: z.string().trim().min(1, "Bezeichnung fehlt").max(200),
  active: z.boolean(),
  contactId: z.uuid(),
  format: z.enum(["zugferd", "xrechnung-cii", "xrechnung-ubl"]),
  paymentTermDays: z.number().int().min(0).max(120),
  note: z.string().max(2000),
  taxTreatment: z.enum(TAX_TREATMENT_KEYS),
  exemptionReason: z.string().trim().max(300),
  lines: z.array(invoiceLineInputSchema).min(1, "Mindestens eine Position").max(200),
  intervalMonths: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
  nextDate: isoDate,
  endDate: isoDate.nullable(),
  servicePeriod: z.enum(["laufend", "vorher", "keiner"]),
  mode: z.enum(["entwurf", "festschreiben"]),
  /** Nur mit festschreiben wirksam */
  sendByMail: z.boolean().default(false),
});

export type RecurringInput = z.input<typeof recurringInputSchema>;

function values(raw: RecurringInput) {
  const input = recurringInputSchema.parse(raw);
  if (input.endDate && input.endDate < input.nextDate) throw new RecurringError("Das Enddatum liegt vor dem nächsten Termin.");
  return {
    ...input,
    exemptionReason: input.taxTreatment === "regulaer" ? "" : input.exemptionReason,
    sendByMail: input.mode === "festschreiben" && input.sendByMail,
    anchorDay: Number(input.nextDate.slice(8, 10)),
    updatedAt: new Date(),
  };
}

export async function listRecurring() {
  return db
    .select({
      recurring: schema.recurringInvoices,
      contactName: schema.contacts.name,
    })
    .from(schema.recurringInvoices)
    .innerJoin(schema.contacts, eq(schema.contacts.id, schema.recurringInvoices.contactId))
    .orderBy(desc(schema.recurringInvoices.active), asc(schema.recurringInvoices.nextDate));
}

export async function getRecurring(id: string) {
  const [recurring] = await db.select().from(schema.recurringInvoices).where(eq(schema.recurringInvoices.id, id));
  if (!recurring) return null;
  const invoices = await db
    .select({
      id: schema.invoices.id,
      number: schema.invoices.number,
      status: schema.invoices.status,
      issueDate: schema.invoices.issueDate,
      gross: schema.invoices.gross,
      recurringDate: schema.invoices.recurringDate,
    })
    .from(schema.invoices)
    .where(eq(schema.invoices.recurringId, id))
    .orderBy(desc(schema.invoices.recurringDate));
  return { recurring, invoices };
}

export async function createRecurring(actor: string, input: RecurringInput): Promise<RecurringInvoice> {
  return withActor(actor, async (tx) => {
    const [created] = await tx.insert(schema.recurringInvoices).values(values(input)).returning();
    return created!;
  });
}

export async function updateRecurring(actor: string, id: string, input: RecurringInput): Promise<RecurringInvoice> {
  return withActor(actor, async (tx) => {
    const [updated] = await tx
      .update(schema.recurringInvoices)
      .set({ ...values(input), lastError: null })
      .where(eq(schema.recurringInvoices.id, id))
      .returning();
    if (!updated) throw new RecurringError("Vorlage nicht gefunden.");
    return updated;
  });
}

/** Löschen nur, solange keine Rechnung daraus entstanden ist; sonst deaktivieren */
export async function deleteRecurring(actor: string, id: string): Promise<void> {
  await withActor(actor, async (tx) => {
    const [used] = await tx.select({ id: schema.invoices.id }).from(schema.invoices).where(eq(schema.invoices.recurringId, id)).limit(1);
    if (used) throw new RecurringError("Aus der Vorlage sind schon Rechnungen entstanden. Deaktiviere sie stattdessen.");
    await tx.delete(schema.recurringInvoices).where(eq(schema.recurringInvoices.id, id));
  });
}

/** Rechnung zu einem Termin: Leistungszeitraum und Platzhalter aus der Vorlage */
export function invoiceForDate(recurring: RecurringInvoice, date: string, language: "de" | "en" = "de") {
  const period = servicePeriodFor(date, recurring.intervalMonths as RecurringInterval, recurring.servicePeriod as ServicePeriodMode);
  const reference = period ?? { from: date, to: date };
  return {
    contactId: recurring.contactId,
    issueDate: date,
    serviceFrom: period?.from ?? null,
    serviceTo: period?.to ?? null,
    paymentTermDays: recurring.paymentTermDays,
    format: recurring.format,
    note: fillPlaceholders(recurring.note, reference),
    taxTreatment: recurring.taxTreatment,
    exemptionReason: recurring.exemptionReason,
    language,
    lines: recurring.lines.map((line) => ({
      description: fillPlaceholders(line.description, reference),
      quantity: line.quantity,
      unit: line.unit as UnitLabel,
      unitPrice: line.unitPrice,
      taxRate: line.taxRate as 1900 | 700 | 0,
    })),
  };
}

export interface RunResult {
  created: number;
  finalized: number;
  /** per E-Mail an den Kunden geschickt */
  mailed: number;
  errors: string[];
}

/** Meldung für lastError: Fachfehler und Eingabefehler im Klartext, alles andere nur ins Server-Log */
function describe(error: unknown): string {
  const message = userMessage(error);
  if (message === undefined) console.error("Wiederkehrende Rechnung:", error);
  return message ?? INTERNAL_ERROR;
}


async function runOne(recurring: RecurringInvoice, today: string, result: RunResult): Promise<void> {
  const interval = recurring.intervalMonths as RecurringInterval;
  const dates = dueDates(recurring.nextDate, interval, recurring.anchorDay, today, recurring.endDate);
  let lastError: string | null = null;
  // Sprache aus dem Kontakt, wie beim Anlegen im Editor
  const [contact] = await db.select({ language: schema.contacts.language }).from(schema.contacts).where(eq(schema.contacts.id, recurring.contactId));
  for (const date of dates) {
    const [existing] = await db
      .select({ id: schema.invoices.id })
      .from(schema.invoices)
      .where(and(eq(schema.invoices.recurringId, recurring.id), eq(schema.invoices.recurringDate, date)));
    if (existing) continue;
    let draftId: string;
    try {
      const draft = await createDraft(RECURRING_ACTOR, invoiceForDate(recurring, date, contact?.language), { recurringId: recurring.id, recurringDate: date });
      draftId = draft.id;
      result.created++;
    } catch (error) {
      // Gleichzeitiger Lauf hat den Termin schon angelegt
      if (isUniqueViolation(error, "invoices_recurring_date")) continue;
      throw error;
    }
    if (recurring.mode === "festschreiben") {
      try {
        await finalizeInvoice(RECURRING_ACTOR, draftId);
        result.finalized++;
      } catch (error) {
        // Entwurf bleibt stehen, damit nichts verloren geht
        lastError = `Rechnung vom ${date} als Entwurf angelegt, Festschreiben fehlgeschlagen: ${describe(error)}`;
        result.errors.push(`${recurring.name}: ${lastError}`);
        continue;
      }
      if (recurring.sendByMail) {
        try {
          const sent = await sendInvoiceMailWithTemplate(RECURRING_ACTOR, draftId);
          if (sent.ok) result.mailed++;
          else throw new MailError(sent.error ?? "unbekannter Fehler");
        } catch (error) {
          // Die Rechnung ist festgeschrieben; nur der Versand fehlt, von Hand auf der Rechnungsseite nachholbar
          lastError = `Rechnung vom ${date} festgeschrieben, E-Mail nicht gesendet: ${describe(error)}`;
          result.errors.push(`${recurring.name}: ${lastError}`);
        }
      }
    }
  }
  const last = dates.at(-1);
  const nextDate = last ? addMonthsAnchored(last, interval, recurring.anchorDay) : recurring.nextDate;
  const ended = recurring.endDate !== null && nextDate > recurring.endDate;
  await withActor(RECURRING_ACTOR, (tx) =>
    tx
      .update(schema.recurringInvoices)
      .set({ nextDate, active: !ended, lastRunAt: new Date(), lastError })
      .where(eq(schema.recurringInvoices.id, recurring.id)),
  );
}

/**
 * Legt für alle fälligen Termine Rechnungen an, verpasste werden nachgeholt (je Termin mit seinem Datum).
 * Je Termin entsteht höchstens eine Rechnung (eindeutiger Index), auch wenn zwei Läufe gleichzeitig starten.
 */
export async function runDueRecurring(today: string): Promise<RunResult> {
  const result: RunResult = { created: 0, finalized: 0, mailed: 0, errors: [] };
  const due = await db
    .select()
    .from(schema.recurringInvoices)
    .where(and(eq(schema.recurringInvoices.active, true), lte(schema.recurringInvoices.nextDate, today)));

  for (const recurring of due) {
    try {
      await runOne(recurring, today, result);
    } catch (error) {
      // Der Lauf geht mit der nächsten Vorlage weiter; nextDate bleibt, schon angelegte Termine überspringt der nächste Lauf
      const lastError = describe(error);
      result.errors.push(`${recurring.name}: ${lastError}`);
      await withActor(RECURRING_ACTOR, (tx) =>
        tx.update(schema.recurringInvoices).set({ lastRunAt: new Date(), lastError }).where(eq(schema.recurringInvoices.id, recurring.id)),
      ).catch((e: unknown) => console.error("Wiederkehrende Rechnung: Fehler nicht gespeichert", e));
    }
  }
  return result;
}

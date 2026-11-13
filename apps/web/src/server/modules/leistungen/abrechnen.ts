import { type BillingPreview, billingPreview, type OffeneLeistung } from "@haben/core";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Tx } from "../../db/index.ts";
import { assertCustomer, defaultSkonto, type DraftInput, insertDraft, newDraftDefaults } from "../rechnungen/index.ts";
import { onActiveInvoice, ServiceEntryError } from "./service-entries.ts";

/*
 * Leistungen abrechnen (#417): Die offenen, abrechenbaren Einträge eines Kunden und Zeitraums werden ein Rechnungsentwurf.
 * Je Stundensatz entsteht eine Position „Leistungen“ in Std. (billingPreview in packages/core), Leistungszeitraum ist der
 * erste bis letzte Arbeitstag. Jeder Eintrag trägt danach die Nummer des Entwurfs (service_entries.invoice_id) und ist
 * nicht noch einmal abrechenbar. Löscht man den Entwurf, löst die Datenbank die Verknüpfung (on delete set null); nach
 * dem Storno gilt der Eintrag wieder als offen, die Auswertung steht in onActiveInvoice. Eine Buchung entsteht hier
 * nicht, die macht das Festschreiben der Rechnung.
 */

export const billingSchema = z
  .object({
    contactId: z.uuid("Kunde fehlt"),
    from: z.iso.date("Von-Datum ungültig"),
    to: z.iso.date("Bis-Datum ungültig"),
  })
  .refine((d) => d.from <= d.to, { message: "Der Zeitraum endet vor seinem Beginn", path: ["to"] });

export type BillingInput = z.input<typeof billingSchema>;

type OpenEntry = OffeneLeistung & { id: string };

export type { BillingLine, BillingPreview } from "@haben/core";

async function openEntries(q: typeof db | Tx, input: z.infer<typeof billingSchema>, lock: boolean): Promise<OpenEntry[]> {
  const query = q
    .select({
      id: schema.serviceEntries.id,
      workedOn: schema.serviceEntries.workedOn,
      minutes: schema.serviceEntries.minutes,
      billableMinutes: schema.serviceEntries.billableMinutes,
      nonBillable: schema.serviceEntries.nonBillable,
      hourlyRateCents: schema.serviceEntries.hourlyRateCents,
      project: schema.serviceEntries.project,
    })
    .from(schema.serviceEntries)
    .where(
      and(
        eq(schema.serviceEntries.contactId, input.contactId),
        gte(schema.serviceEntries.workedOn, input.from),
        lte(schema.serviceEntries.workedOn, input.to),
        eq(schema.serviceEntries.nonBillable, false),
        sql`not ${onActiveInvoice}`,
      ),
    )
    .orderBy(asc(schema.serviceEntries.workedOn), asc(schema.serviceEntries.createdAt));
  // Gesperrt, damit zwei gleichzeitige Abrechnungen dieselben Einträge nicht beide nehmen: die zweite sieht sie danach als abgerechnet
  return lock ? query.for("update") : query;
}

/** Was „Abrechnen“ für diesen Kunden und Zeitraum anlegen würde, ohne etwas zu ändern */
export async function previewBilling(input: BillingInput): Promise<BillingPreview> {
  return billingPreview(await openEntries(db, billingSchema.parse(input), false));
}

/** Legt aus den offenen, abrechenbaren Einträgen einen Rechnungsentwurf an und verknüpft sie damit */
export async function billServiceEntries(actor: string, input: BillingInput, today: string): Promise<{ invoiceId: string; entries: number }> {
  const data = billingSchema.parse(input);
  return withActor(actor, async (tx) => {
    await assertCustomer(tx, data.contactId);
    const entries = await openEntries(tx, data, true);
    if (entries.length === 0) throw new ServiceEntryError("Im Zeitraum gibt es keine offenen, abrechenbaren Einträge dieses Kunden.");
    const preview = billingPreview(entries);
    if (preview.withoutRate > 0) {
      throw new ServiceEntryError(
        `Bei ${preview.withoutRate} ${preview.withoutRate === 1 ? "Eintrag fehlt" : "Einträgen fehlt"} der Stundensatz. Trage ihn am Eintrag oder im Kontakt ein, dann lässt sich abrechnen.`,
      );
    }
    const defaults = await newDraftDefaults(today);
    // Vorgaben des Kunden wie im Rechnungseditor (chooseContact), bei Angebot und API: Format (mit Leitweg-ID XRechnung), Sprache, Skonto
    const [contact] = await tx
      .select({
        defaultFormat: schema.contacts.defaultFormat,
        leitwegId: schema.contacts.leitwegId,
        language: schema.contacts.language,
        skonto: schema.contacts.skonto,
      })
      .from(schema.contacts)
      .where(eq(schema.contacts.id, data.contactId));
    const taxRate = defaults.lines[0]!.taxRate;
    const draft: DraftInput = {
      ...defaults,
      contactId: data.contactId,
      format: contact?.defaultFormat ?? (contact?.leitwegId ? "xrechnung-cii" : defaults.format),
      language: contact?.language ?? defaults.language,
      skonto: defaultSkonto({ skonto: defaults.skonto }, contact, defaults.paymentTermDays),
      issueDate: today,
      serviceFrom: preview.from,
      serviceTo: preview.to,
      lines: preview.lines.map((line) => ({
        description: "Leistungen",
        detail: line.projects.length > 0 ? `Projekt: ${line.projects.join(", ")}` : "",
        quantity: line.quantity,
        unit: "Std.",
        unitPrice: line.rateCents,
        taxRate,
        discount: null,
      })),
    };
    const invoice = await insertDraft(tx, draft);
    await tx
      .update(schema.serviceEntries)
      .set({ invoiceId: invoice.id, updatedAt: sql`now()` })
      .where(
        sql`${schema.serviceEntries.id} in (${sql.join(
          entries.map((e) => sql`${e.id}`),
          sql`, `,
        )})`,
      );
    return { invoiceId: invoice.id, entries: entries.length };
  });
}

/** Die Einträge, die eine Rechnung enthält (Nachweis für den Kunden und für dich), nach Arbeitstag */
export async function serviceEntriesOfInvoice(invoiceId: string) {
  return db
    .select({
      id: schema.serviceEntries.id,
      workedOn: schema.serviceEntries.workedOn,
      minutes: schema.serviceEntries.minutes,
      billableMinutes: schema.serviceEntries.billableMinutes,
      nonBillable: schema.serviceEntries.nonBillable,
      description: schema.serviceEntries.description,
      project: schema.serviceEntries.project,
      hourlyRateCents: schema.serviceEntries.hourlyRateCents,
    })
    .from(schema.serviceEntries)
    .where(eq(schema.serviceEntries.invoiceId, invoiceId))
    .orderBy(asc(schema.serviceEntries.workedOn), asc(schema.serviceEntries.createdAt));
}

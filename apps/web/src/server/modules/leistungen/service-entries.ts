import { and, asc, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";

/**
 * Abrechenbare Leistungen (#417): Zeiteinträge je Kunde. Die Dauer steht in Minuten (höchstens ein Tag), der
 * Stundensatz in Cent als Kopie vom Anlegen: Er kommt vom Kunden, ein eigener Satz am Eintrag geht vor, und eine
 * spätere Änderung am Kunden berührt bestehende Einträge nicht. Von außen (Kimai, Toggl) angelegte Einträge tragen
 * Quelle und Kennung; derselbe Aufruf zweimal ergibt einen Eintrag.
 */

export class ServiceEntryError extends UserError {}

export const isRealDate = (v: string) => {
  const d = new Date(`${v}T00:00:00Z`);
  // Jahre vor 1900 sind kein Arbeitstag; Postgres lehnt 0000 ab
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && d.getUTCFullYear() >= 1900;
};

export const serviceEntrySchema = z.object({
  contactId: z.string().uuid("Kunde fehlt"),
  workedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Datum hat die Form JJJJ-MM-TT")
    .refine(isRealDate, "Datum ungültig"),
  minutes: z
    .number()
    .int("Dauer in ganzen Minuten")
    .min(1, "Dauer fehlt")
    .max(24 * 60, "Dauer höchstens 24 Stunden"),
  description: z.string().trim().max(2000).default(""),
  /** Stundensatz in Cent; fehlt = der Satz des Kunden (beim Anlegen) bzw. unverändert (beim Ändern) */
  hourlyRateCents: z.number().int("Stundensatz in ganzen Cent").min(0, "Stundensatz nicht negativ").max(100_000_00, "Stundensatz zu hoch").optional(),
  /** Erfasst, aber nie in einem Rechnungsentwurf; fehlt = nein (beim Anlegen) bzw. unverändert (beim Ändern) */
  nonBillable: z.boolean().optional(),
  /** Abrechenbare Dauer in Minuten; null = die erfasste, fehlt = unverändert */
  billableMinutes: z
    .number()
    .int("Abrechenbare Dauer in ganzen Minuten")
    .min(1, "Abrechenbare Dauer fehlt")
    .max(24 * 60, "Abrechenbare Dauer höchstens 24 Stunden")
    .nullable()
    .optional(),
  /** Projekt als freier Text; keine Projektverwaltung */
  project: z.string().trim().max(200, "Projekt höchstens 200 Zeichen").optional(),
});

export type ServiceEntryInput = z.input<typeof serviceEntrySchema>;

const externalSchema = serviceEntrySchema.extend({
  source: z.string().trim().min(1, "Quelle fehlt").max(40),
  externalId: z.string().trim().min(1, "Kennung fehlt").max(200),
});

export type ExternalServiceEntryInput = z.input<typeof externalSchema>;

export interface ServiceEntry {
  id: string;
  contactId: string;
  workedOn: string;
  minutes: number;
  description: string;
  hourlyRateCents: number | null;
  nonBillable: boolean;
  billableMinutes: number | null;
  project: string;
  source: string | null;
  externalId: string | null;
  /** Rechnung, auf der der Eintrag steht (Entwurf oder festgeschrieben); null = offen, auch nach dem Storno der Rechnung */
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceStatus: "draft" | "final" | null;
}

/** Rechnungen, die durch eine festgeschriebene Stornorechnung aufgehoben sind (wie bei der Abrechnung von Angeboten) */
const cancelledInvoices = sql`select corrects_id from invoices where kind = 'storno' and status = 'final' and corrects_id is not null`;

/** Der Eintrag steht auf einer Rechnung, die gilt: Entwurf oder festgeschrieben und nicht storniert */
export const onActiveInvoice = sql<boolean>`(${schema.serviceEntries.invoiceId} is not null and ${schema.serviceEntries.invoiceId} not in (${cancelledInvoices}))`;

const columns = {
  id: schema.serviceEntries.id,
  contactId: schema.serviceEntries.contactId,
  workedOn: schema.serviceEntries.workedOn,
  minutes: schema.serviceEntries.minutes,
  description: schema.serviceEntries.description,
  hourlyRateCents: schema.serviceEntries.hourlyRateCents,
  nonBillable: schema.serviceEntries.nonBillable,
  billableMinutes: schema.serviceEntries.billableMinutes,
  project: schema.serviceEntries.project,
  source: schema.serviceEntries.externalSource,
  externalId: schema.serviceEntries.externalId,
  invoiceId: sql<string | null>`case when ${onActiveInvoice} then ${schema.serviceEntries.invoiceId} end`,
  invoiceNumber: sql<string | null>`case when ${onActiveInvoice} then ${schema.invoices.number} end`,
  invoiceStatus: sql<"draft" | "final" | null>`case when ${onActiveInvoice} then ${schema.invoices.status} end`,
};

const withInvoice = eq(schema.invoices.id, schema.serviceEntries.invoiceId);

export interface ServiceEntryFilter {
  contactId?: string;
  /** Arbeitstage von bis einschließlich, JJJJ-MM-TT */
  from?: string;
  to?: string;
  /** offen = abrechenbar und auf keiner Rechnung; abgerechnet = auf einer Rechnung (Entwurf oder festgeschrieben); nicht abrechenbar */
  status?: "offen" | "abgerechnet" | "nicht-abrechenbar";
}

/** Einträge, die neuesten Arbeitstage zuerst */
export async function listServiceEntries(filter: ServiceEntryFilter = {}): Promise<ServiceEntry[]> {
  return db
    .select(columns)
    .from(schema.serviceEntries)
    .leftJoin(schema.invoices, withInvoice)
    .where(
      and(
        filter.status === "offen" ? and(eq(schema.serviceEntries.nonBillable, false), sql`not ${onActiveInvoice}`) : undefined,
        filter.status === "abgerechnet" ? onActiveInvoice : undefined,
        filter.status === "nicht-abrechenbar" ? eq(schema.serviceEntries.nonBillable, true) : undefined,
        filter.contactId ? eq(schema.serviceEntries.contactId, filter.contactId) : undefined,
        filter.from ? gte(schema.serviceEntries.workedOn, filter.from) : undefined,
        filter.to ? lte(schema.serviceEntries.workedOn, filter.to) : undefined,
      ),
    )
    .orderBy(desc(schema.serviceEntries.workedOn), desc(schema.serviceEntries.createdAt));
}

export interface EntryCustomer {
  id: string;
  name: string;
  hourlyRateCents: number | null;
  /** Archiviert oder kein Kunde mehr, aber mit Einträgen: steht in der Liste und im Filter, wird für neue Einträge nicht angeboten */
  inactive: boolean;
}

/** Die Kunden der Seite: alle aktiven und die archivierten oder nicht mehr als Kunde geführten, bei denen noch Einträge liegen; nach Name */
export async function listEntryCustomers(): Promise<EntryCustomer[]> {
  const c = schema.contacts;
  const rows = await db
    .select({ id: c.id, name: c.name, hourlyRateCents: c.hourlyRateCents, archivedAt: c.archivedAt, isCustomer: c.isCustomer })
    .from(c)
    .where(or(and(eq(c.isCustomer, true), isNull(c.archivedAt)), sql`${c.id} in (select ${schema.serviceEntries.contactId} from ${schema.serviceEntries})`))
    .orderBy(asc(c.name));
  return rows.map(({ archivedAt, isCustomer, ...rest }) => ({ ...rest, inactive: archivedAt !== null || !isCustomer }));
}

/** Ein Eintrag; null, wenn es ihn nicht gibt */
export async function getServiceEntry(id: string): Promise<ServiceEntry | null> {
  const [row] = await db.select(columns).from(schema.serviceEntries).leftJoin(schema.invoices, withInvoice).where(eq(schema.serviceEntries.id, id));
  return row ?? null;
}

/** Sperrt den Eintrag und lehnt ab, wenn er auf einer Rechnung steht, die gilt: erst den Entwurf löschen bzw. die Rechnung stornieren */
async function lockOpenEntry(tx: Tx, id: string): Promise<{ id: string; contactId: string }> {
  const [entry] = await tx
    .select({
      id: schema.serviceEntries.id,
      contactId: schema.serviceEntries.contactId,
      number: schema.invoices.number,
      status: schema.invoices.status,
      billed: onActiveInvoice,
    })
    .from(schema.serviceEntries)
    .leftJoin(schema.invoices, withInvoice)
    .where(eq(schema.serviceEntries.id, id))
    .for("update", { of: schema.serviceEntries });
  if (!entry) throw new ServiceEntryError("Eintrag nicht gefunden.");
  if (entry.billed) {
    throw new ServiceEntryError(
      entry.status === "draft"
        ? "Der Eintrag steht auf einem Rechnungsentwurf. Lösche den Entwurf, dann lässt er sich wieder ändern."
        : `Der Eintrag ist mit der Rechnung ${entry.number} abgerechnet. Erst ein Storno der Rechnung macht ihn wieder änderbar.`,
    );
  }
  return entry;
}

/** Der Stundensatz des Kunden; wirft, wenn es den Kunden nicht gibt, er keiner (nur Lieferant) oder archiviert ist */
async function contactRate(tx: Tx, contactId: string): Promise<number | null> {
  const [contact] = await tx
    .select({ rate: schema.contacts.hourlyRateCents, isCustomer: schema.contacts.isCustomer, archivedAt: schema.contacts.archivedAt })
    .from(schema.contacts)
    .where(eq(schema.contacts.id, contactId));
  if (!contact) throw new ServiceEntryError("Kunde nicht gefunden.");
  if (!contact.isCustomer) throw new ServiceEntryError("Der Kontakt ist kein Kunde.");
  if (contact.archivedAt !== null) throw new ServiceEntryError("Der Kunde ist archiviert.");
  return contact.rate;
}

/** Werte der neuen Felder beim Anlegen: ohne Angabe nicht „nicht abrechenbar“, ohne abrechenbare Dauer, ohne Projekt */
const vorgaben = (data: { nonBillable?: boolean; billableMinutes?: number | null; project?: string }) => ({
  nonBillable: data.nonBillable ?? false,
  billableMinutes: data.billableMinutes ?? null,
  project: data.project ?? "",
});

export async function createServiceEntry(actor: string, input: ServiceEntryInput): Promise<string> {
  const data = serviceEntrySchema.parse(input);
  return withActor(actor, async (tx) => {
    const contactDefault = await contactRate(tx, data.contactId);
    const rate = data.hourlyRateCents ?? contactDefault;
    const [created] = await tx
      .insert(schema.serviceEntries)
      .values({ ...data, ...vorgaben(data), hourlyRateCents: rate, createdBy: actor })
      .returning({ id: schema.serviceEntries.id });
    return created!.id;
  });
}

export async function updateServiceEntry(actor: string, id: string, input: ServiceEntryInput): Promise<void> {
  const data = serviceEntrySchema.parse(input);
  await withActor(actor, async (tx) => {
    const entry = await lockOpenEntry(tx, id);
    // Ein Eintrag bleibt änderbar, auch wenn der Kunde inzwischen archiviert ist; ein anderer Kunde muss passen
    if (entry.contactId !== data.contactId) await contactRate(tx, data.contactId);
    await tx
      .update(schema.serviceEntries)
      .set({ ...data, hourlyRateCents: data.hourlyRateCents, updatedAt: sql`now()` })
      .where(eq(schema.serviceEntries.id, id));
  });
}

export async function deleteServiceEntry(actor: string, id: string): Promise<void> {
  await withActor(actor, async (tx) => {
    await lockOpenEntry(tx, id);
    await tx.delete(schema.serviceEntries).where(eq(schema.serviceEntries.id, id));
  });
}

/**
 * Legt einen Eintrag mit Quelle und Kennung an oder aktualisiert den vorhandenen mit derselben Kennung (ein Zeiterfassungs-
 * programm schickt dieselbe Zeile bei jedem Abruf). Ein vorhandener Satz bleibt, wenn der Aufruf keinen mitbringt.
 */
export async function upsertExternalServiceEntry(actor: string, input: ExternalServiceEntryInput): Promise<{ id: string; created: boolean }> {
  const { source, externalId, ...rest } = externalSchema.parse(input);
  return withActor(actor, async (tx) => {
    // Ein schon abgerechneter Eintrag bleibt, wie er ist: ein erneuter Abruf aus dem Zeiterfassungsprogramm ändert ihn nicht, meldet aber keinen Fehler
    const [existing] = await tx
      .select({ id: schema.serviceEntries.id, billed: onActiveInvoice })
      .from(schema.serviceEntries)
      .where(and(eq(schema.serviceEntries.externalSource, source), eq(schema.serviceEntries.externalId, externalId)))
      .for("update");
    if (existing?.billed) return { id: existing.id, created: false };
    const contactDefault = await contactRate(tx, rest.contactId);
    const rate = rest.hourlyRateCents ?? contactDefault;
    const [row] = await tx
      .insert(schema.serviceEntries)
      .values({ ...rest, ...vorgaben(rest), hourlyRateCents: rate, externalSource: source, externalId, createdBy: actor })
      .onConflictDoUpdate({
        target: [schema.serviceEntries.externalSource, schema.serviceEntries.externalId],
        set: {
          contactId: rest.contactId,
          workedOn: rest.workedOn,
          minutes: rest.minutes,
          description: rest.description,
          ...(rest.hourlyRateCents === undefined ? {} : { hourlyRateCents: rest.hourlyRateCents }),
          ...(rest.nonBillable === undefined ? {} : { nonBillable: rest.nonBillable }),
          ...(rest.billableMinutes === undefined ? {} : { billableMinutes: rest.billableMinutes }),
          ...(rest.project === undefined ? {} : { project: rest.project }),
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: schema.serviceEntries.id, created: sql<boolean>`(xmax = 0)` });
    return { id: row!.id, created: row!.created };
  });
}

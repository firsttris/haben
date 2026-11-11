import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
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

const isRealDate = (v: string) => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
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
  hourlyRateCents: z.number().int("Stundensatz in ganzen Cent").min(0, "Stundensatz nicht negativ").optional(),
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
  source: string | null;
  externalId: string | null;
}

const columns = {
  id: schema.serviceEntries.id,
  contactId: schema.serviceEntries.contactId,
  workedOn: schema.serviceEntries.workedOn,
  minutes: schema.serviceEntries.minutes,
  description: schema.serviceEntries.description,
  hourlyRateCents: schema.serviceEntries.hourlyRateCents,
  source: schema.serviceEntries.externalSource,
  externalId: schema.serviceEntries.externalId,
};

export interface ServiceEntryFilter {
  contactId?: string;
  /** Arbeitstage von bis einschließlich, JJJJ-MM-TT */
  from?: string;
  to?: string;
}

/** Einträge, die neuesten Arbeitstage zuerst */
export async function listServiceEntries(filter: ServiceEntryFilter = {}): Promise<ServiceEntry[]> {
  return db
    .select(columns)
    .from(schema.serviceEntries)
    .where(
      and(
        filter.contactId ? eq(schema.serviceEntries.contactId, filter.contactId) : undefined,
        filter.from ? gte(schema.serviceEntries.workedOn, filter.from) : undefined,
        filter.to ? lte(schema.serviceEntries.workedOn, filter.to) : undefined,
      ),
    )
    .orderBy(desc(schema.serviceEntries.workedOn), desc(schema.serviceEntries.createdAt));
}

/** Der Stundensatz des Kunden; wirft, wenn es ihn nicht gibt */
async function contactRate(tx: Tx, contactId: string): Promise<number | null> {
  const [contact] = await tx.select({ rate: schema.contacts.hourlyRateCents }).from(schema.contacts).where(eq(schema.contacts.id, contactId));
  if (!contact) throw new ServiceEntryError("Kunde nicht gefunden.");
  return contact.rate;
}

export async function createServiceEntry(actor: string, input: ServiceEntryInput): Promise<string> {
  const data = serviceEntrySchema.parse(input);
  return withActor(actor, async (tx) => {
    const contactDefault = await contactRate(tx, data.contactId);
    const rate = data.hourlyRateCents ?? contactDefault;
    const [created] = await tx
      .insert(schema.serviceEntries)
      .values({ ...data, hourlyRateCents: rate, createdBy: actor })
      .returning({ id: schema.serviceEntries.id });
    return created!.id;
  });
}

export async function updateServiceEntry(actor: string, id: string, input: ServiceEntryInput): Promise<void> {
  const data = serviceEntrySchema.parse(input);
  await withActor(actor, async (tx) => {
    const [entry] = await tx.select({ id: schema.serviceEntries.id }).from(schema.serviceEntries).where(eq(schema.serviceEntries.id, id)).for("update");
    if (!entry) throw new ServiceEntryError("Eintrag nicht gefunden.");
    await contactRate(tx, data.contactId);
    await tx
      .update(schema.serviceEntries)
      .set({ ...data, hourlyRateCents: data.hourlyRateCents, updatedAt: sql`now()` })
      .where(eq(schema.serviceEntries.id, id));
  });
}

export async function deleteServiceEntry(actor: string, id: string): Promise<void> {
  await withActor(actor, async (tx) => {
    const [entry] = await tx.select({ id: schema.serviceEntries.id }).from(schema.serviceEntries).where(eq(schema.serviceEntries.id, id)).for("update");
    if (!entry) throw new ServiceEntryError("Eintrag nicht gefunden.");
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
    const contactDefault = await contactRate(tx, rest.contactId);
    const rate = rest.hourlyRateCents ?? contactDefault;
    const [row] = await tx
      .insert(schema.serviceEntries)
      .values({ ...rest, hourlyRateCents: rate, externalSource: source, externalId, createdBy: actor })
      .onConflictDoUpdate({
        target: [schema.serviceEntries.externalSource, schema.serviceEntries.externalId],
        set: {
          contactId: rest.contactId,
          workedOn: rest.workedOn,
          minutes: rest.minutes,
          description: rest.description,
          ...(rest.hourlyRateCents === undefined ? {} : { hourlyRateCents: rest.hourlyRateCents }),
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: schema.serviceEntries.id, created: sql<boolean>`(xmax = 0)` });
    return { id: row!.id, created: row!.created };
  });
}

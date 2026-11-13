import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";

/**
 * Ansprechpartner am Kontakt (#424). Eine Person ist änderbar, aber nicht löschbar (Trigger, drizzle/0207): Sie kann an
 * Entwürfen hängen, und beim Festschreiben steht ihr Stand als `ansprechpartner` im Käufer des Belegs. Wer nicht mehr
 * dabei ist, wird deaktiviert; ein Entwurf behält die gewählte Person trotzdem, neu wählbar sind nur aktive.
 */

export class ContactPersonError extends UserError {}

export const contactPersonInputSchema = z.object({
  name: z.string().trim().min(1, "Name fehlt").max(100),
  email: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === "" || /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(v), "E-Mail-Adresse ungültig")
    .default(""),
  telefon: z.string().trim().max(50).default(""),
  /** Funktion oder Abteilung; steht nur in Haben, nicht im PDF und nicht in der E-Rechnung */
  funktion: z.string().trim().max(100).default(""),
});

export type ContactPersonInput = z.input<typeof contactPersonInputSchema>;

export interface ContactPerson {
  id: string;
  contactId: string;
  name: string;
  email: string;
  telefon: string;
  funktion: string;
  deactivatedAt: Date | null;
}

const columns = {
  id: schema.contactPersons.id,
  contactId: schema.contactPersons.contactId,
  name: schema.contactPersons.name,
  email: schema.contactPersons.email,
  telefon: schema.contactPersons.telefon,
  funktion: schema.contactPersons.funktion,
  deactivatedAt: schema.contactPersons.deactivatedAt,
};

/** Alle Personen eines Kontakts, die aktiven zuerst, dann nach Name */
export async function listContactPersons(contactId: string): Promise<ContactPerson[]> {
  return db
    .select(columns)
    .from(schema.contactPersons)
    .where(eq(schema.contactPersons.contactId, contactId))
    .orderBy(sql`${schema.contactPersons.deactivatedAt} is not null`, asc(schema.contactPersons.name), asc(schema.contactPersons.createdAt));
}

export async function createContactPerson(actor: string, contactId: string, input: ContactPersonInput): Promise<string> {
  const data = contactPersonInputSchema.parse(input);
  return withActor(actor, async (tx) => {
    const [contact] = await tx.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.id, contactId));
    if (!contact) throw new ContactPersonError("Kontakt nicht gefunden.");
    const [created] = await tx
      .insert(schema.contactPersons)
      .values({ ...data, contactId, createdBy: actor })
      .returning({ id: schema.contactPersons.id });
    return created!.id;
  });
}

export async function updateContactPerson(actor: string, id: string, input: ContactPersonInput): Promise<void> {
  const data = contactPersonInputSchema.parse(input);
  await withActor(actor, async (tx) => {
    const [person] = await tx.select({ id: schema.contactPersons.id }).from(schema.contactPersons).where(eq(schema.contactPersons.id, id)).for("update");
    if (!person) throw new ContactPersonError("Ansprechpartner nicht gefunden.");
    await tx.update(schema.contactPersons).set(data).where(eq(schema.contactPersons.id, id));
  });
}

/** Deaktivieren oder wieder aktivieren; gelöscht wird nie */
export async function setContactPersonActive(actor: string, id: string, active: boolean): Promise<void> {
  await withActor(actor, async (tx) => {
    const [person] = await tx.select().from(schema.contactPersons).where(eq(schema.contactPersons.id, id)).for("update");
    if (!person) throw new ContactPersonError("Ansprechpartner nicht gefunden.");
    if (active === (person.deactivatedAt === null)) return;
    await tx
      .update(schema.contactPersons)
      .set({ deactivatedAt: active ? null : sql`now()` })
      .where(eq(schema.contactPersons.id, id));
  });
}

/**
 * Warum eine Person an einem Entwurf des Kontakts nicht gewählt werden darf; null, wenn es geht. Sie muss zum Kontakt
 * gehören und aktiv sein, außer der Entwurf hat sie schon (dann bleibt sie, auch wenn sie inzwischen deaktiviert ist).
 */
export async function contactPersonProblem(
  executor: Pick<Tx, "select">,
  contactId: string | null,
  personId: string | null,
  current: string | null = null,
): Promise<string | null> {
  if (personId === null) return null;
  if (contactId === null) return "Ansprechpartner brauchen einen Kunden.";
  const [person] = await executor
    .select({ contactId: schema.contactPersons.contactId, deactivatedAt: schema.contactPersons.deactivatedAt })
    .from(schema.contactPersons)
    .where(and(eq(schema.contactPersons.id, personId)));
  if (!person) return "Ansprechpartner nicht gefunden.";
  if (person.contactId !== contactId) return "Der Ansprechpartner gehört zu einem anderen Kunden.";
  if (person.deactivatedAt !== null && personId !== current) return "Der Ansprechpartner ist deaktiviert.";
  return null;
}

/** Stand der Person für den Käufer des Belegs (Snapshot beim Festschreiben); leere Angaben fehlen */
export async function ansprechpartnerSnapshot(
  executor: Pick<Tx, "select">,
  personId: string | null,
): Promise<{ name: string; email?: string; telefon?: string; funktion?: string } | undefined> {
  if (personId === null) return undefined;
  const [person] = await executor.select(columns).from(schema.contactPersons).where(eq(schema.contactPersons.id, personId));
  if (!person) return undefined;
  return {
    name: person.name,
    ...(person.email ? { email: person.email } : {}),
    ...(person.telefon ? { telefon: person.telefon } : {}),
    ...(person.funktion ? { funktion: person.funktion } : {}),
  };
}

/** Alle Personen aller Kontakte für die Auswahl im Editor von Rechnung und Angebot; die Oberfläche filtert nach Kunde und Zustand */
export async function contactPersonOptions(): Promise<{ id: string; contactId: string; name: string; deactivated: boolean }[]> {
  const rows = await db
    .select({
      id: schema.contactPersons.id,
      contactId: schema.contactPersons.contactId,
      name: schema.contactPersons.name,
      deactivatedAt: schema.contactPersons.deactivatedAt,
    })
    .from(schema.contactPersons)
    .orderBy(asc(schema.contactPersons.name), asc(schema.contactPersons.createdAt));
  return rows.map(({ deactivatedAt, ...person }) => ({ ...person, deactivated: deactivatedAt !== null }));
}

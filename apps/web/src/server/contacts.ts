import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "./db/actor.ts";
import { db, schema } from "./db/index.ts";

export const contactSchema = z.object({
  kundennummer: z.string().trim().max(40),
  name: z.string().trim().min(1, "Name fehlt").max(200),
  strasse: z.string().trim().max(200),
  plz: z.string().trim().max(10),
  ort: z.string().trim().max(100),
  land: z.string().trim().regex(/^[A-Z]{2}$/, "Ländercode wie DE"),
  email: z.union([z.literal(""), z.email("Keine gültige E-Mail-Adresse")]),
  ustId: z.union([z.literal(""), z.string().trim().regex(/^[A-Z]{2}[0-9A-Z+*.]{2,12}$/, "USt-IdNr. hat die Form DE123456789")]),
  iban: z.union([z.literal(""), z.string().trim().regex(/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/, "IBAN ohne Leerzeichen")]),
  leitwegId: z.string().trim().max(46),
  defaultFormat: z.enum(["zugferd", "xrechnung-cii", "xrechnung-ubl"]).nullable(),
  /** Sprache von Rechnungen und Angeboten */
  language: z.enum(["de", "en"]).default("de"),
});

export type ContactInput = z.input<typeof contactSchema>;
export type Contact = typeof schema.contacts.$inferSelect;

export class ContactError extends Error {}

export async function listContacts(includeArchived = false): Promise<Contact[]> {
  return db
    .select()
    .from(schema.contacts)
    .where(includeArchived ? undefined : isNull(schema.contacts.archivedAt))
    .orderBy(asc(schema.contacts.name));
}

export async function getContact(id: string) {
  const [contact] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, id));
  if (!contact) return null;
  const versions = await db
    .select({ version: schema.contactVersions.version, createdAt: schema.contactVersions.createdAt })
    .from(schema.contactVersions)
    .where(eq(schema.contactVersions.contactId, id))
    .orderBy(desc(schema.contactVersions.version));
  return { contact, versions };
}

function clean(input: ContactInput) {
  return {
    ...input,
    kundennummer: input.kundennummer || null,
    ustId: input.ustId.replace(/\s/g, "").toUpperCase(),
    iban: input.iban.replace(/\s/g, "").toUpperCase(),
  };
}

export async function createContact(actor: string, input: ContactInput): Promise<Contact> {
  return withActor(actor, async (tx) => {
    const [created] = await tx.insert(schema.contacts).values(clean(input)).returning();
    return created!;
  });
}

/** Änderungen erhöhen per Trigger die Version; alte Stände bleiben in contact_versions. */
export async function updateContact(actor: string, id: string, input: ContactInput): Promise<Contact> {
  return withActor(actor, async (tx) => {
    const [updated] = await tx
      .update(schema.contacts)
      .set(clean(input))
      .where(and(eq(schema.contacts.id, id)))
      .returning();
    if (!updated) throw new ContactError("Kontakt nicht gefunden.");
    return updated;
  });
}

export async function setContactArchived(actor: string, id: string, archived: boolean) {
  await withActor(actor, (tx) =>
    tx
      .update(schema.contacts)
      .set({ archivedAt: archived ? new Date() : null })
      .where(eq(schema.contacts.id, id)),
  );
}

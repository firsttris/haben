import { UserError } from "../../errors.ts";
import { joinEmails, MAX_EMAIL_RECIPIENTS, normalizeTelefon, skontoProblem, skontoStufenSchema, sortSkonto, splitEmails, telefonProblem } from "@haben/core";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Tx } from "../../db/index.ts";
import { takeCustomerNumber } from "./customer-numbers.ts";

export const contactSchema = z.object({
  kundennummer: z.string().trim().max(40),
  name: z.string().trim().min(1, "Name fehlt").max(200),
  strasse: z.string().trim().max(200),
  plz: z.string().trim().max(10),
  ort: z.string().trim().max(100),
  land: z
    .string()
    .trim()
    .regex(/^[A-Z]{2}$/, "Ländercode wie DE"),
  /** Eine oder mehrere Adressen, durch Komma getrennt (z. B. Rechnungseingang und Freigeber); gespeichert mit „, “ */
  email: z
    .string()
    .trim()
    .max(1000)
    .refine((value) => splitEmails(value).length <= MAX_EMAIL_RECIPIENTS, `Höchstens ${MAX_EMAIL_RECIPIENTS} E-Mail-Adressen`)
    .refine((value) => splitEmails(value).every((v) => z.email().safeParse(v).success), "Keine gültige E-Mail-Adresse")
    .transform((value) => joinEmails(splitEmails(value))),
  /** Fehlt = leer, wie bei Kontakten von vor #322 */
  telefon: z
    .string()
    .default("")
    .superRefine((value, ctx) => {
      const problem = telefonProblem(value);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    })
    .transform(normalizeTelefon),
  ustId: z.union([
    z.literal(""),
    z
      .string()
      .trim()
      .regex(/^[A-Z]{2}[0-9A-Z+*.]{2,12}$/, "USt-IdNr. hat die Form DE123456789"),
  ]),
  iban: z.union([
    z.literal(""),
    z
      .string()
      .trim()
      .regex(/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/, "IBAN ohne Leerzeichen"),
  ]),
  leitwegId: z.string().trim().max(46),
  defaultFormat: z.enum(["zugferd", "xrechnung-cii", "xrechnung-ubl"]).nullable(),
  /**
   * Skonto für Rechnungen an diesen Kunden; null = Vorgabe aus den Firmendaten, leer = kein Skonto, fehlt = unverändert.
   * Eine Frist länger als das Zahlungsziel der Rechnung entfällt dort (defaultSkonto).
   */
  skonto: z.optional(z.nullable(skontoStufenSchema)).superRefine((skonto, ctx) => {
    // Ohne Zahlungsziel des Kunden: nur doppelte Fristen und die Reihenfolge der Sätze prüfen
    const problem = skonto ? skontoProblem(skonto, 120) : null;
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  }),
  /** Sprache von Rechnungen und Angeboten */
  language: z.enum(["de", "en"]).default("de"),
  /** Rollen; mindestens eine (cleanRoles). Fehlt = Kunde wie bisher */
  isCustomer: z.boolean().default(true),
  isSupplier: z.boolean().default(false),
  lieferantennummer: z.string().trim().max(40).default(""),
});

export type ContactRole = "kunde" | "lieferant";

export type ContactInput = z.input<typeof contactSchema>;
export type Contact = typeof schema.contacts.$inferSelect;

export class ContactError extends UserError {}

/** Kontakte nach Name; mit role nur Kunden bzw. nur Lieferanten (wer beides ist, steht in beiden) */
export async function listContacts(includeArchived = false, role?: ContactRole): Promise<Contact[]> {
  const roleFilter = role === "kunde" ? eq(schema.contacts.isCustomer, true) : role === "lieferant" ? eq(schema.contacts.isSupplier, true) : undefined;
  return db
    .select()
    .from(schema.contacts)
    .where(and(includeArchived ? undefined : isNull(schema.contacts.archivedAt), roleFilter))
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
  const isCustomer = input.isCustomer ?? true;
  const isSupplier = input.isSupplier ?? false;
  if (!isCustomer && !isSupplier) throw new ContactError("Ein Kontakt ist Kunde oder Lieferant oder beides.");
  return {
    ...input,
    isCustomer,
    isSupplier,
    lieferantennummer: input.lieferantennummer?.trim() || null,
    kundennummer: input.kundennummer || null,
    email: joinEmails(splitEmails(input.email)),
    telefon: normalizeTelefon(input.telefon ?? ""),
    ustId: input.ustId.replace(/\s/g, "").toUpperCase(),
    iban: input.iban.replace(/\s/g, "").toUpperCase(),
    ...(input.skonto === undefined ? {} : { skonto: input.skonto && sortSkonto(input.skonto) }),
  };
}

export async function createContact(actor: string, input: ContactInput): Promise<Contact> {
  return withActor(actor, (tx) => insertContact(tx, input));
}

/** Legt einen Kontakt in der laufenden Transaktion an; auch für den CSV-Import, der alle Zeilen in einer Transaktion anlegt */
export async function insertContact(tx: Tx, input: ContactInput): Promise<Contact> {
  const values = clean(input);
  // Ohne eigene Nummer vergibt Haben die nächste, wenn in den Einstellungen ein Format steht; nur an Kunden,
  // ein reiner Lieferant hat keine Kundennummer (#224)
  // Eine eigene Nummer geht immer über die Sperre der Firmenzeile, damit keine gleichzeitige Vergabe sie doppelt nimmt
  const kundennummer = values.isCustomer || values.kundennummer ? await takeCustomerNumber(tx, values.kundennummer) : null;
  const [created] = await tx
    .insert(schema.contacts)
    .values({ ...values, kundennummer })
    .returning();
  return created!;
}

/** Änderungen erhöhen per Trigger die Version; alte Stände bleiben in contact_versions. */
export async function updateContact(actor: string, id: string, input: ContactInput): Promise<Contact> {
  return withActor(actor, async (tx) => {
    const [updated] = await tx.update(schema.contacts).set(clean(input)).where(eq(schema.contacts.id, id)).returning();
    if (!updated) throw new ContactError("Kontakt nicht gefunden.");
    return updated;
  });
}

/**
 * Trägt eine IBAN in einen Kontakt ein, der noch keine hat (#410: ausdrücklich bestätigte IBAN aus einer E-Rechnung).
 * Eine vorhandene IBAN überschreibt Haben nie; false, wenn der Kontakt inzwischen eine hat. In der Transaktion des
 * Aufrufers, damit Bestätigung und Kontakt zusammen gelten. Die Version erhöht wie bei jeder Änderung der Trigger.
 */
export async function setContactIbanIfEmpty(tx: Tx, id: string, iban: string): Promise<boolean> {
  const updated = await tx
    .update(schema.contacts)
    .set({ iban })
    .where(and(eq(schema.contacts.id, id), sql`coalesce(${schema.contacts.iban}, '') = ''`))
    .returning({ id: schema.contacts.id });
  return updated.length > 0;
}

export async function setContactArchived(actor: string, id: string, archived: boolean) {
  await withActor(actor, (tx) =>
    tx
      .update(schema.contacts)
      .set({ archivedAt: archived ? new Date() : null })
      .where(eq(schema.contacts.id, id)),
  );
}

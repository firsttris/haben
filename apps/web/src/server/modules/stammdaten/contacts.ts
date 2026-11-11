import { UserError } from "../../errors.ts";
import {
  joinEmails,
  MAX_EMAIL_RECIPIENTS,
  normalizeTelefon,
  PERSONENKONTO_LABEL,
  type PersonenkontoRolle,
  personenkontoProblem,
  skontoProblem,
  skontoStufenSchema,
  sortSkonto,
  splitEmails,
  telefonProblem,
} from "@haben/core";
import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Tx } from "../../db/index.ts";
import { isUniqueViolation } from "../../errors.ts";
import { takeCustomerNumber } from "./customer-numbers.ts";

function personenkonto(rolle: PersonenkontoRolle) {
  return z.optional(
    z.nullable(z.number()).superRefine((nr, ctx) => {
      const problem = nr === null ? null : personenkontoProblem(rolle, nr);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
  );
}

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
  /** DATEV-Personenkonten (#327); null = keins, fehlt = unverändert */
  debitorNr: personenkonto("debitor"),
  kreditorNr: personenkonto("kreditor"),
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

/** Ein Kontakt zur Auswahl in einem Formular (ContactCombobox): mit der Nummer der Rolle, Kunden- oder Lieferantennummer */
export interface ContactChoice {
  id: string;
  name: string;
  ort: string;
  nummer: string | null;
  ustId: string;
  isCustomer: boolean;
  isSupplier: boolean;
}

/**
 * Kontakte (ohne archivierte) zur Auswahl in einem Formular. Bei Lieferanten nur die Lieferanten, wie bisher: Das Formular
 * braucht keine anderen, und der Beleg geht auch an die Steuerberatung. Bei Kunden alle, denn ein gewählter Kontakt, der kein
 * Kunde mehr ist, soll im Feld sichtbar bleiben; die Combobox filtert nach der Rolle. role bestimmt auch, welche Nummer
 * als Nummer gilt.
 */
export async function listContactChoices(role: ContactRole): Promise<ContactChoice[]> {
  const contacts = await listContacts(false, role === "lieferant" ? "lieferant" : undefined);
  return contacts.map((c) => ({
    id: c.id,
    name: c.name,
    ort: c.ort,
    nummer: role === "lieferant" ? c.lieferantennummer : c.kundennummer,
    ustId: c.ustId,
    isCustomer: c.isCustomer,
    isSupplier: c.isSupplier,
  }));
}

/** Kontakt mit gleicher USt-IdNr., als Hinweis beim Anlegen oder Ändern (ContactForm) */
export interface UstIdMatch {
  id: string;
  name: string;
  ustId: string;
  isCustomer: boolean;
  isSupplier: boolean;
  archived: boolean;
}

/** USt-IdNr. ohne Leerzeichen und in Großbuchstaben, wie sie gespeichert wird */
const compactUstId = (value: string) => value.replace(/\s/g, "").toUpperCase();

/**
 * Kontakte aller Rollen mit derselben USt-IdNr., auch archivierte; excludeId nimmt den Kontakt aus, den das Formular
 * gerade ändert. Der Hinweis soll eine Dublette verhindern, ohne Kontakte still zusammenzuführen. Aus mehr als fünf
 * Treffern bleiben die ersten fünf; wanted (die Rollen des neuen Kontakts) stellt die Kontakte voran, die alle diese
 * Rollen haben, denn nur einen solchen kann man statt eines neuen wählen.
 */
export async function findContactsByUstId(
  ustId: string,
  excludeId?: string,
  wanted: { isCustomer?: boolean; isSupplier?: boolean } = {},
): Promise<UstIdMatch[]> {
  const compact = compactUstId(ustId);
  if (!compact) return [];
  const rows = await db
    .select({
      id: schema.contacts.id,
      name: schema.contacts.name,
      ustId: schema.contacts.ustId,
      isCustomer: schema.contacts.isCustomer,
      isSupplier: schema.contacts.isSupplier,
      archivedAt: schema.contacts.archivedAt,
    })
    .from(schema.contacts)
    .where(and(sql`upper(replace(${schema.contacts.ustId}, ' ', '')) = ${compact}`, excludeId ? ne(schema.contacts.id, excludeId) : undefined))
    // Aktive zuerst: Ein archivierter Kontakt darf einen aktiven mit derselben USt-IdNr. nicht verdecken; dann die mit den
    // gewünschten Rollen, damit sie nicht hinter fünf anderen aus der Liste fallen
    .orderBy(
      sql`${schema.contacts.archivedAt} is not null`,
      sql`not (${wanted.isCustomer ? schema.contacts.isCustomer : sql`true`} and ${wanted.isSupplier ? schema.contacts.isSupplier : sql`true`})`,
      asc(schema.contacts.name),
    )
    .limit(5);
  return rows.map(({ archivedAt, ...rest }) => ({ ...rest, archived: archivedAt !== null }));
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
  for (const rolle of ["debitor", "kreditor"] as const) {
    const nr = input[`${rolle}Nr`];
    const problem = nr == null ? null : personenkontoProblem(rolle, nr);
    if (problem) throw new ContactError(problem);
  }
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
  const [created] = await samePersonenkonto(tx, () =>
    tx
      .insert(schema.contacts)
      .values({ ...values, kundennummer })
      .returning(),
  );
  return created!;
}

/**
 * Debitor und Kreditor sind eindeutig (Unique-Constraints in contacts). Statt des Fehlers der Datenbank nennt die Meldung
 * den Kontakt, der die Nummer schon hat. Ein Savepoint hält die Transaktion des Aufrufers für die Abfrage benutzbar.
 */
async function samePersonenkonto<T>(tx: Tx, write: () => Promise<T>): Promise<T> {
  try {
    return await tx.transaction(write);
  } catch (error) {
    for (const rolle of ["debitor", "kreditor"] as const) {
      if (!isUniqueViolation(error, `contacts_${rolle}_nr_unique`)) continue;
      const nr = Number(/\((\d+)\)/.exec(String((error as { cause?: { detail?: string } }).cause?.detail))?.[1]);
      const column = rolle === "debitor" ? schema.contacts.debitorNr : schema.contacts.kreditorNr;
      const [owner] = Number.isFinite(nr) ? await tx.select({ name: schema.contacts.name }).from(schema.contacts).where(eq(column, nr)) : [];
      throw new ContactError(`${PERSONENKONTO_LABEL[rolle]} ${nr} hat schon „${owner?.name ?? "einen anderen Kontakt"}“.`);
    }
    throw error;
  }
}

/** Änderungen erhöhen per Trigger die Version; alte Stände bleiben in contact_versions. */
export async function updateContact(actor: string, id: string, input: ContactInput): Promise<Contact> {
  return withActor(actor, async (tx) => {
    const [updated] = await samePersonenkonto(tx, () => tx.update(schema.contacts).set(clean(input)).where(eq(schema.contacts.id, id)).returning());
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

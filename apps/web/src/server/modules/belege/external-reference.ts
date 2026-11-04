import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../../db/index.ts";

/*
 * Externe Referenz eines Belegs (#104): Quelle und Kennung des Dokuments in einem System außerhalb von Haben, etwa einem
 * Dokumentenarchiv oder Scanner, das Belege über die REST-API liefert. Dieselbe Referenz legt keinen zweiten Beleg an,
 * sondern liefert den vorhandenen; so darf ein Werkzeug einen Beleg gefahrlos erneut schicken. Der eindeutige Index
 * documents_external_ref sichert das auch bei gleichzeitigen Anfragen. Dieselben Regeln wie bei Rechnungen
 * (rechnungen/external-reference.ts), nur mit Wörtern für Belege.
 */

export const documentReferenceSchema = z.object({
  /** Quelle in Kleinbuchstaben, z. B. archiv, scanner, mail */
  externalSource: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9._-]*$/, "Quelle in Kleinbuchstaben, Ziffern, Punkt, Bindestrich oder Unterstrich, z. B. archiv"),
  /** Kennung des Dokuments in der Quelle */
  externalId: z
    .string()
    .trim()
    .min(1, "Kennung fehlt")
    .max(100)
    .regex(/^[^\p{Cc}]+$/u, "Kennung ohne Steuerzeichen"),
});

export type DocumentReference = z.infer<typeof documentReferenceSchema>;

export async function findDocumentByReference(reference: DocumentReference): Promise<{ id: string } | null> {
  const [found] = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(and(eq(schema.documents.externalSource, reference.externalSource), eq(schema.documents.externalId, reference.externalId)));
  return found ?? null;
}

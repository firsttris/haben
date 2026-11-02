import { UserError } from "../../errors.ts";
import { asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";

/**
 * Textbausteine: Kopf- und Fußtexte zum Einfügen in Rechnungen, Angebote und wiederkehrende Rechnungen.
 * Eingefügt wird eine Kopie des Textes; Änderungen am Baustein wirken nicht auf schon geschriebene Belege.
 */

export type TextBlock = typeof schema.textBlocks.$inferSelect;

export class TextBlockError extends UserError {}

export const textBlockInputSchema = z.object({
  name: z.string().trim().min(1, "Bezeichnung fehlt").max(200),
  kind: z.enum(schema.textBlockKinds),
  text: z.string().trim().min(1, "Text fehlt").max(2000),
  /** Kunde, zu dem der Baustein gehört; null = für alle */
  contactId: z.uuid().nullable().default(null),
});

export type TextBlockInput = z.input<typeof textBlockInputSchema>;

/** Nach Art (Kopftext vor Fußtext), dann nach Bezeichnung */
export async function listTextBlocks({ archived = false }: { archived?: boolean } = {}): Promise<TextBlock[]> {
  return db
    .select()
    .from(schema.textBlocks)
    .where(archived ? undefined : isNull(schema.textBlocks.archivedAt))
    .orderBy(asc(schema.textBlocks.kind), asc(schema.textBlocks.name));
}

async function checkContact(contactId: string | null) {
  if (!contactId) return;
  const [contact] = await db.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.id, contactId));
  if (!contact) throw new TextBlockError("Kontakt nicht gefunden.");
}

export async function createTextBlock(actor: string, input: TextBlockInput): Promise<TextBlock> {
  const values = textBlockInputSchema.parse(input);
  await checkContact(values.contactId);
  const [row] = await withActor(actor, (tx) => tx.insert(schema.textBlocks).values(values).returning());
  return row!;
}

export async function updateTextBlock(actor: string, id: string, input: TextBlockInput): Promise<TextBlock> {
  const values = textBlockInputSchema.parse(input);
  await checkContact(values.contactId);
  const [row] = await withActor(actor, (tx) =>
    tx
      .update(schema.textBlocks)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(schema.textBlocks.id, id))
      .returning(),
  );
  if (!row) throw new TextBlockError("Textbaustein nicht gefunden.");
  return row;
}

/** Archivieren statt löschen, wie beim Artikelkatalog */
export async function setTextBlockArchived(actor: string, id: string, archived: boolean): Promise<void> {
  const [row] = await withActor(actor, (tx) =>
    tx
      .update(schema.textBlocks)
      .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
      .where(eq(schema.textBlocks.id, id))
      .returning({ id: schema.textBlocks.id }),
  );
  if (!row) throw new TextBlockError("Textbaustein nicht gefunden.");
}

import { UserError } from "../../errors.ts";
import { asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Tx } from "../../db/index.ts";
import { contactRoleProblem } from "./contacts.ts";

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

/** Ein Baustein gehört zu einem Kunden; ein Lieferant oder ein unbekannter Kontakt passt nicht */
async function checkContact(tx: Tx, contactId: string | null) {
  if (!contactId) return;
  const problem = await contactRoleProblem(tx, contactId, "kunde");
  if (problem) throw new TextBlockError(problem);
}

export async function createTextBlock(actor: string, input: TextBlockInput): Promise<TextBlock> {
  const values = textBlockInputSchema.parse(input);
  return withActor(actor, async (tx) => {
    await checkContact(tx, values.contactId);
    const [row] = await tx.insert(schema.textBlocks).values(values).returning();
    return row!;
  });
}

export async function updateTextBlock(actor: string, id: string, input: TextBlockInput): Promise<TextBlock> {
  const values = textBlockInputSchema.parse(input);
  return withActor(actor, async (tx) => {
    const [previous] = await tx.select({ contactId: schema.textBlocks.contactId }).from(schema.textBlocks).where(eq(schema.textBlocks.id, id)).for("update");
    if (!previous) throw new TextBlockError("Textbaustein nicht gefunden.");
    // Nur eine neue Zuordnung wird geprüft: ein Kontakt, der inzwischen kein Kunde mehr ist, bleibt am Baustein
    if (values.contactId !== previous.contactId) await checkContact(tx, values.contactId);
    const [row] = await tx
      .update(schema.textBlocks)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(schema.textBlocks.id, id))
      .returning();
    return row!;
  });
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

import { UserError } from "../../errors.ts";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { type Db, db, schema, type Tx } from "../../db/index.ts";
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
  /** Standard für diese Belegart (#1494); null = kein Standard */
  standardFuer: z.enum(schema.textBlockStandards).nullable().default(null),
});

export type TextBlockInput = z.input<typeof textBlockInputSchema>;

/** Was gegen den Standard spricht: Ein Standard gilt für alle Kunden, und der Lieferschein hat nur einen Hinweis (Fußtext) */
function standardProblem(values: z.output<typeof textBlockInputSchema>): string | null {
  if (!values.standardFuer) return null;
  if (values.contactId) return "Ein Standard gilt für alle Kunden; ein Baustein für einen Kunden kann kein Standard sein.";
  if (values.standardFuer === "lieferschein" && values.kind === "kopf")
    return "Der Lieferschein hat nur einen Hinweis; als Standard geht dort nur ein Fußtext.";
  return null;
}

/** Ein neuer Standard löst den bisherigen derselben Belegart und Art ab (höchstens einer, text_blocks_standard) */
async function standardAbloesen(tx: Tx, values: z.output<typeof textBlockInputSchema>, id: string | null) {
  if (!values.standardFuer) return;
  const problem = standardProblem(values);
  if (problem) throw new TextBlockError(problem);
  const gleich = and(
    eq(schema.textBlocks.standardFuer, values.standardFuer),
    eq(schema.textBlocks.kind, values.kind),
    id ? ne(schema.textBlocks.id, id) : undefined,
  );
  await tx.update(schema.textBlocks).set({ standardFuer: null, updatedAt: new Date() }).where(gleich);
}

/**
 * Texte des Standards einer Belegart (#1494): Kopftext für die Einleitung, Fußtext für Hinweis bzw. Schlusstext; leer
 * ohne Standard. Platzhalter bleiben stehen; eingesetzt werden sie in Vorschau und beim Festschreiben (#1334).
 */
export async function standardTexte(belegart: schema.TextBlockStandard, q: Db | Tx = db): Promise<{ kopf: string; fuss: string }> {
  const rows = await q
    .select({ kind: schema.textBlocks.kind, text: schema.textBlocks.text })
    .from(schema.textBlocks)
    .where(and(eq(schema.textBlocks.standardFuer, belegart), isNull(schema.textBlocks.archivedAt)));
  return { kopf: rows.find((r) => r.kind === "kopf")?.text ?? "", fuss: rows.find((r) => r.kind === "fuss")?.text ?? "" };
}

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
  return withActor(actor, (tx) => insertTextBlock(tx, input));
}

/**
 * createTextBlock in der Transaktion des Aufrufers. `uebernommen`: aus einer anderen Instanz (#488); die Zuordnung bestand
 * dort schon und bleibt wie bei updateTextBlock, auch wenn der Kontakt inzwischen kein Kunde mehr ist
 */
export async function insertTextBlock(tx: Tx, input: TextBlockInput, { uebernommen = false }: { uebernommen?: boolean } = {}): Promise<TextBlock> {
  const values = textBlockInputSchema.parse(input);
  if (!uebernommen) await checkContact(tx, values.contactId);
  else if (values.contactId && (await tx.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.id, values.contactId))).length === 0)
    throw new TextBlockError("Kontakt nicht gefunden.");
  await standardAbloesen(tx, values, null);
  const [row] = await tx.insert(schema.textBlocks).values(values).returning();
  return row!;
}

export async function updateTextBlock(actor: string, id: string, input: TextBlockInput): Promise<TextBlock> {
  const values = textBlockInputSchema.parse(input);
  return withActor(actor, async (tx) => {
    const [previous] = await tx
      .select({ contactId: schema.textBlocks.contactId, archivedAt: schema.textBlocks.archivedAt })
      .from(schema.textBlocks)
      .where(eq(schema.textBlocks.id, id))
      .for("update");
    if (!previous) throw new TextBlockError("Textbaustein nicht gefunden.");
    // Sonst nähme ein archivierter Baustein dem aktiven die Markierung, ohne selbst Standard zu sein (text_blocks_standard)
    if (previous.archivedAt && values.standardFuer)
      throw new TextBlockError("Ein archivierter Baustein kann kein Standard sein; stelle ihn zuerst wieder her.");
    // Nur eine neue Zuordnung wird geprüft: ein Kontakt, der inzwischen kein Kunde mehr ist, bleibt am Baustein
    if (values.contactId !== previous.contactId) await checkContact(tx, values.contactId);
    await standardAbloesen(tx, values, id);
    const [row] = await tx
      .update(schema.textBlocks)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(schema.textBlocks.id, id))
      .returning();
    return row!;
  });
}

/** Archivieren statt löschen, wie beim Artikelkatalog; ein archivierter Baustein ist kein Standard mehr (#1494) */
export async function setTextBlockArchived(actor: string, id: string, archived: boolean): Promise<void> {
  const [row] = await withActor(actor, (tx) =>
    tx
      .update(schema.textBlocks)
      .set({ archivedAt: archived ? new Date() : null, ...(archived ? { standardFuer: null } : {}), updatedAt: new Date() })
      .where(eq(schema.textBlocks.id, id))
      .returning({ id: schema.textBlocks.id }),
  );
  if (!row) throw new TextBlockError("Textbaustein nicht gefunden.");
}

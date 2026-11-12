import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { env } from "../../env.ts";
import { UserError } from "../../errors.ts";
import { checkEmbedding, type EmbeddingResult } from "./embedding.ts";
import { checkPageUrl } from "./url.ts";

/**
 * Eigene Seiten (#199): Menüeinträge, die eine Seite außerhalb von Haben im Rahmen zeigen oder in einem neuen Tab öffnen
 * (#636). Haben speichert nur Name, Adresse und wie sie sich öffnet; die Seite meldet sich selbst an und greift mit eigenem API-Token auf die REST-API zu.
 */

export type CustomPage = typeof schema.customPages.$inferSelect;

export class CustomPageError extends UserError {}

export const customPageInputSchema = z.object({
  /** Kurz, er steht im Menü */
  name: z.string().trim().min(1, "Name fehlt").max(40, "Der Name darf höchstens 40 Zeichen lang sein."),
  url: z.string().trim().min(1, "Adresse fehlt").max(2000, "Die Adresse ist zu lang."),
  /** Im Menü in einem neuen Tab öffnen statt im Rahmen (#636) */
  openInNewTab: z.boolean().default(false),
});

export type CustomPageInput = z.input<typeof customPageInputSchema>;

/** Nach Name, so wie sie im Menü stehen */
export async function listCustomPages(): Promise<CustomPage[]> {
  return db.select().from(schema.customPages).orderBy(asc(schema.customPages.name), asc(schema.customPages.createdAt));
}

export async function getCustomPage(id: string): Promise<CustomPage | null> {
  const [row] = await db.select().from(schema.customPages).where(eq(schema.customPages.id, id));
  return row ?? null;
}

function validate(input: CustomPageInput) {
  const { name, url, openInNewTab } = customPageInputSchema.parse(input);
  const checked = checkPageUrl(url, env().BETTER_AUTH_URL);
  if (!checked.ok) throw new CustomPageError(checked.message);
  return { name, url: checked.url, openInNewTab };
}

export async function createCustomPage(actor: string, input: CustomPageInput): Promise<CustomPage> {
  const values = validate(input);
  const [row] = await withActor(actor, (tx) => tx.insert(schema.customPages).values(values).returning());
  return row!;
}

export async function updateCustomPage(actor: string, id: string, input: CustomPageInput): Promise<CustomPage> {
  const values = validate(input);
  const [row] = await withActor(actor, (tx) =>
    tx
      .update(schema.customPages)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(schema.customPages.id, id))
      .returning(),
  );
  if (!row) throw new CustomPageError("Seite nicht gefunden.");
  return row;
}

/** Löschen statt archivieren: Eine eigene Seite ist eine Einstellung, kein Beleg; das Änderungsprotokoll behält sie */
/** Prüft vor dem Speichern, ob die Seite das Einbetten erlaubt (#636); dieselbe Adressprüfung wie beim Speichern */
export async function checkCustomPageEmbedding(url: string): Promise<EmbeddingResult> {
  const checked = checkPageUrl(url, env().BETTER_AUTH_URL);
  if (!checked.ok) throw new CustomPageError(checked.message);
  return checkEmbedding(checked.url, env().BETTER_AUTH_URL);
}

export async function deleteCustomPage(actor: string, id: string): Promise<void> {
  const [row] = await withActor(actor, (tx) => tx.delete(schema.customPages).where(eq(schema.customPages.id, id)).returning({ id: schema.customPages.id }));
  if (!row) throw new CustomPageError("Seite nicht gefunden.");
}

import { UNITS, type UnitLabel } from "@haben/core";
import { asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "./db/actor.ts";
import { db, schema } from "./db/index.ts";

/** Artikel- und Leistungskatalog: Vorlagen für Positionen in Rechnungen und Angeboten */

export type Article = typeof schema.articles.$inferSelect;

export class ArticleError extends Error {}

export const articleInputSchema = z.object({
  number: z.string().trim().max(50).default(""),
  description: z.string().trim().min(1, "Bezeichnung fehlt").max(500),
  unit: z.enum(Object.keys(UNITS) as [UnitLabel, ...UnitLabel[]]),
  unitPrice: z.number().int().min(-100_000_000_00).max(100_000_000_00),
  taxRate: z.union([z.literal(1900), z.literal(700), z.literal(0)]),
  note: z.string().trim().max(1000).default(""),
});

export type ArticleInput = z.input<typeof articleInputSchema>;

/** Aktive Artikel zuerst nach Nummer, dann nach Bezeichnung */
export async function listArticles({ archived = false }: { archived?: boolean } = {}): Promise<Article[]> {
  return db
    .select()
    .from(schema.articles)
    .where(archived ? undefined : isNull(schema.articles.archivedAt))
    .orderBy(asc(schema.articles.number), asc(schema.articles.description));
}

export async function createArticle(actor: string, input: ArticleInput): Promise<Article> {
  const values = articleInputSchema.parse(input);
  const [row] = await withActor(actor, (tx) => tx.insert(schema.articles).values(values).returning());
  return row!;
}

export async function updateArticle(actor: string, id: string, input: ArticleInput): Promise<Article> {
  const values = articleInputSchema.parse(input);
  const [row] = await withActor(actor, (tx) =>
    tx
      .update(schema.articles)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(schema.articles.id, id))
      .returning(),
  );
  if (!row) throw new ArticleError("Artikel nicht gefunden.");
  return row;
}

/** Archivieren statt löschen: alte Rechnungen behalten ihre Texte ohnehin, der Katalog bleibt nachvollziehbar */
export async function setArticleArchived(actor: string, id: string, archived: boolean): Promise<void> {
  const [row] = await withActor(actor, (tx) =>
    tx
      .update(schema.articles)
      .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
      .where(eq(schema.articles.id, id))
      .returning({ id: schema.articles.id }),
  );
  if (!row) throw new ArticleError("Artikel nicht gefunden.");
}

import { UserError } from "../../errors.ts";
import { ITEM_NUMBER_MAX, LINE_DETAIL_MAX, UNIT_LABEL_MAX, inCents, inBasisPoints } from "@haben/core";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { likePattern, unaccentIlike } from "../../../lib/search.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Tx } from "../../db/index.ts";
import { assertKnownUnit } from "./units.ts";

/** Artikel- und Leistungskatalog: Vorlagen für Positionen in Rechnungen und Angeboten */

export type Article = typeof schema.articles.$inferSelect;

export class ArticleError extends UserError {}

export const articleInputSchema = z.object({
  number: z.string().trim().max(ITEM_NUMBER_MAX).default(""),
  description: z.string().trim().min(1, "Bezeichnung fehlt").max(500),
  /** Text unter der Bezeichnung, mehrzeilig; geht beim Einfügen in den Text der Position */
  detail: z.string().trim().max(LINE_DETAIL_MAX).default(""),
  /** Feste oder eigene Einheit (#748); ob es sie gibt, prüft assertKnownUnit beim Speichern */
  unit: z.string().trim().min(1, "Einheit fehlt").max(UNIT_LABEL_MAX),
  unitPrice: inCents(z.int32()),
  taxRate: inBasisPoints(z.union([z.literal(1900), z.literal(700), z.literal(0)])),
  /** Preis inklusive Umsatzsteuer; beim Einfügen in eine Rechnung mit anderem Preismodus umgerechnet */
  priceIncludesTax: z.boolean().default(false),
  note: z.string().trim().max(1000).default(""),
});

export type ArticleInput = z.input<typeof articleInputSchema>;

const articleFields = articleInputSchema.shape;
// Zod setzt Vorgaben auch bei optionalen Feldern ein. PATCH lässt ausgelassene Felder aus.
export const articlePatchSchema = articleInputSchema
  .extend({
    number: articleFields.number.unwrap(),
    detail: articleFields.detail.unwrap(),
    priceIncludesTax: articleFields.priceIncludesTax.unwrap(),
    note: articleFields.note.unwrap(),
  })
  .partial()
  .strict();

/** Artikel nach Nummer und Bezeichnung */
export async function listArticles({ archived = false, q }: { archived?: boolean; q?: string } = {}): Promise<Article[]> {
  const articles = schema.articles;
  const pattern = q ? likePattern(q) : undefined;
  const search = pattern ? or(unaccentIlike(articles.number, pattern), unaccentIlike(articles.description, pattern)) : undefined;
  return db
    .select()
    .from(articles)
    .where(and(archived ? undefined : isNull(articles.archivedAt), search))
    .orderBy(asc(articles.number), asc(articles.description), asc(articles.id));
}

export async function getArticle(id: string): Promise<Article | null> {
  const [row] = await db.select().from(schema.articles).where(eq(schema.articles.id, id));
  return row ?? null;
}

export async function createArticle(actor: string, input: ArticleInput): Promise<Article> {
  return withActor(actor, (tx) => insertArticle(tx, input));
}

/** Legt einen Artikel in der laufenden Transaktion an; auch für den CSV-Import */
export async function insertArticle(tx: Tx, input: ArticleInput): Promise<Article> {
  const values = articleInputSchema.parse(input);
  await assertKnownUnit(values.unit, tx);
  const [row] = await tx.insert(schema.articles).values(values).returning();
  return row!;
}

async function writeArticle(actor: string, id: string, values: z.output<typeof articlePatchSchema>): Promise<Article | null> {
  return withActor(actor, async (tx) => {
    if (values.unit !== undefined) await assertKnownUnit(values.unit, tx);
    const [row] = await tx
      .update(schema.articles)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(schema.articles.id, id))
      .returning();
    return row ?? null;
  });
}

export async function updateArticle(actor: string, id: string, input: ArticleInput): Promise<Article> {
  const row = await writeArticle(actor, id, articleInputSchema.parse(input));
  if (!row) throw new ArticleError("Artikel nicht gefunden.");
  return row;
}

export async function patchArticle(actor: string, id: string, input: z.input<typeof articlePatchSchema>): Promise<Article | null> {
  const values = articlePatchSchema.parse(input);
  return Object.keys(values).length ? writeArticle(actor, id, values) : getArticle(id);
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

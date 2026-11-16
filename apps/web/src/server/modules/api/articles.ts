import { z } from "zod";
import { articleInputSchema, articlePatchSchema, createArticle, getArticle, listArticles, patchArticle, type Article } from "../stammdaten/index.ts";
import { notFound, ok, validate, type ApiRequest, type ApiResult } from "./http.ts";
import { page, pageQuery, requestSchemas, responseSchemas, timestamp } from "./schemas.ts";

const articleCreateSchema = articleInputSchema.strict().register(requestSchemas, { id: "ArticleCreate" });
articlePatchSchema.register(requestSchemas, { id: "ArticlePatch" });

const articleSchema = articleInputSchema
  .extend({
    id: z.uuid(),
    taxRate: z.number().int().describe("Steuersatz in Basispunkten"),
    archived: z.boolean(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .register(responseSchemas, { id: "Article" });
page(articleSchema).register(responseSchemas, { id: "ArticleList" });

export const articleQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional().describe("Sucht in Artikelnummer und Bezeichnung, unabhängig von Großschreibung und Akzenten"),
    archived: z.enum(["true", "false"]).default("false").describe("true: auch archivierte Artikel"),
    ...pageQuery,
  })
  .strict();

function articleOut(article: Article): z.output<typeof articleSchema> {
  return {
    id: article.id,
    number: article.number,
    description: article.description,
    detail: article.detail,
    unit: article.unit,
    unitPrice: article.unitPrice,
    taxRate: article.taxRate,
    priceIncludesTax: article.priceIncludesTax,
    note: article.note,
    archived: article.archivedAt !== null,
    createdAt: article.createdAt.toISOString(),
    updatedAt: article.updatedAt.toISOString(),
  };
}

export async function listArticlesHandler(request: ApiRequest): Promise<ApiResult> {
  const query = validate(articleQuerySchema, request.query);
  if ("failure" in query) return query.failure;
  const { q, archived, limit, offset } = query.data;
  const articles = await listArticles({ q, archived: archived === "true" });
  return ok({ data: articles.slice(offset, offset + limit).map(articleOut), total: articles.length, limit, offset });
}

export async function getArticleHandler(request: ApiRequest): Promise<ApiResult> {
  const article = await getArticle(request.params.id!);
  return article ? ok(articleOut(article)) : notFound("Artikel nicht gefunden.");
}

export async function createArticleHandler(request: ApiRequest): Promise<ApiResult> {
  const input = validate(articleCreateSchema, request.body);
  if ("failure" in input) return input.failure;
  const article = await createArticle(request.actor, input.data);
  return ok(articleOut(article), 201, { Location: `/api/v1/artikel/${article.id}` });
}

export async function updateArticleHandler(request: ApiRequest): Promise<ApiResult> {
  const input = validate(articlePatchSchema, request.body);
  if ("failure" in input) return input.failure;
  const article = await patchArticle(request.actor, request.params.id!, input.data);
  return article ? ok(articleOut(article)) : notFound("Artikel nicht gefunden.");
}

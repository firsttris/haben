import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ArticleError, articleInputSchema, createArticle, listArticles, setArticleArchived, updateArticle } from "../articles.ts";
import { authMiddleware } from "../middleware.ts";

function asUserError(error: unknown): never {
  if (error instanceof ArticleError) throw new Error(error.message);
  throw error;
}

export const getArticles = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => listArticles({ archived: true }));

export const saveArticle = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid().nullable(), article: articleInputSchema }))
  .handler(async ({ data, context }) => {
    const row = data.id ? await updateArticle(context.user.id, data.id, data.article).catch(asUserError) : await createArticle(context.user.id, data.article);
    return { id: row.id };
  });

export const archiveArticle = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid(), archived: z.boolean() }))
  .handler(async ({ data, context }) => {
    await setArticleArchived(context.user.id, data.id, data.archived).catch(asUserError);
    return { ok: true };
  });

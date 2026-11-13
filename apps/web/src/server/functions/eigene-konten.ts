import { EXPENSE_CATEGORIES } from "@haben/core";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware, readMiddleware } from "../middleware.ts";
import { createOwnAccount, deleteOwnAccount, ownAccountsOverview, renameOwnAccount, setOwnAccountArchived } from "../modules/eigene-konten/index.ts";

/** Eigene Sachkonten (#270): Liste, Anlegen, Umbenennen, Archivieren, Löschen */

export const getOwnAccounts = createServerFn({ method: "GET" })
  .middleware([readMiddleware])
  .handler(() => ownAccountsOverview());

export const createOwnAccountFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ account: z.string(), name: z.string(), parentCategory: z.enum(Object.keys(EXPENSE_CATEGORIES) as [string, ...string[]]) }))
  .handler(async ({ data, context }) => ({
    id: await createOwnAccount(context.user.id, {
      account: data.account,
      name: data.name,
      parentCategory: data.parentCategory as keyof typeof EXPENSE_CATEGORIES,
    }),
  }));

export const renameOwnAccountFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid(), name: z.string() }))
  .handler(async ({ data, context }) => {
    await renameOwnAccount(context.user.id, data.id, data.name);
    return { ok: true };
  });

export const archiveOwnAccountFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid(), archived: z.boolean() }))
  .handler(async ({ data, context }) => {
    await setOwnAccountArchived(context.user.id, data.id, data.archived);
    return { ok: true };
  });

export const deleteOwnAccountFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data, context }) => {
    await deleteOwnAccount(context.user.id, data.id);
    return { ok: true };
  });

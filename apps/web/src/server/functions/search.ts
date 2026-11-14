import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { readMiddleware } from "../middleware.ts";
import { type CommandPaletteResult, type SearchGroup, type RecentPaletteItem, resolveRecentPalette, runCommandPaletteSearch } from "./search-query.ts";

export type { CommandPaletteResult, SearchGroup, RecentPaletteItem };

const searchQuerySchema = z.object({
  query: z.string().trim().max(100),
});

export const searchCommandPalette = createServerFn({ method: "GET" })
  .middleware([readMiddleware])
  .validator(searchQuerySchema)
  .handler(async ({ data, context }) => runCommandPaletteSearch(data.query, context.user.role));

const recentSchema = z.array(z.object({ type: z.enum(["contact", "invoice", "quote", "document"]), id: z.uuid() })).max(8);

export const getRecentPaletteItems = createServerFn({ method: "GET" })
  .middleware([readMiddleware])
  .validator(recentSchema)
  .handler(({ data, context }) => resolveRecentPalette(data, context.user.role));

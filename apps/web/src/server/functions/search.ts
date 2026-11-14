import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { readMiddleware } from "../middleware.ts";
import { type CommandPaletteResult, type SearchGroup, runCommandPaletteSearch } from "./search-query.ts";

export type { CommandPaletteResult, SearchGroup };

const searchQuerySchema = z.object({
  query: z.string().trim().max(200),
});

export const searchCommandPalette = createServerFn({ method: "GET" })
  .middleware([readMiddleware])
  .validator(searchQuerySchema)
  .handler(async ({ data, context }) => runCommandPaletteSearch(data.query, context.user.role));

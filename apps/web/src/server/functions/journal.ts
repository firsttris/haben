import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { loadJournal } from "../journal.ts";
import { authMiddleware } from "../middleware.ts";
import { yearSchema } from "./schemas.ts";

/** Buchungen eines Monats mit ihren Zeilen, nur lesend */
export const getJournal = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ year: yearSchema, month: z.number().int().min(1).max(12) }))
  .handler(({ data }) => loadJournal(data.year, data.month));

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { closeYear, jahresabschluss } from "../modules/buchhaltung/index.ts";
import { authMiddleware } from "../middleware.ts";
import { today } from "../today.ts";
import { yearSchema } from "./schemas.ts";

/** Bilanz und GuV der Kleinst-GmbH, offene Punkte und Stand des Abschlusses */
export const getJahresabschluss = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(yearSchema)
  .handler(({ data }) => jahresabschluss(data, today()));

export const closeYearFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ year: yearSchema }))
  .handler(({ data, context }) => closeYear(context.user.id, data.year, today()));

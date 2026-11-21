import { HORIZONT_KEYS } from "@haben/core";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { liquiditaetsvorschau } from "../modules/liquiditaet/index.ts";
import { readMiddleware } from "../middleware.ts";
import { today } from "../today.ts";

/** Liquiditätsvorschau für die Seite „Auswertungen › Liquidität“ (#1381); `ueberfaellige: false` lässt überfällige Forderungen weg */
export const getLiquiditaet = createServerFn({ method: "GET" })
  .middleware([readMiddleware])
  .validator(z.object({ horizont: z.enum(HORIZONT_KEYS), ueberfaellige: z.boolean() }))
  .handler(({ data }) => liquiditaetsvorschau(today(), data.horizont, { ueberfaellige: data.ueberfaellige }));

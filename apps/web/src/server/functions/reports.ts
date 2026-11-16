import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { versteuerungForYear } from "../modules/stammdaten/index.ts";
import { readMiddleware } from "../middleware.ts";
import { euerForYear, gesamtumsatzForYear, openPositions, reportYears } from "../modules/auswertungen/index.ts";
import { today } from "../today.ts";
import { yearSchema } from "./schemas.ts";

/** EÜR, Monatswerte und offene Posten für die Seite „Auswertungen“ */
export const getReports = createServerFn({ method: "GET" })
  .middleware([readMiddleware])
  .validator(z.object({ year: yearSchema, stichtag: z.literal("31.12.").optional() }))
  .handler(async ({ data }) => {
    const now = today();
    // Der Schalter „31.12.“ zeigt den Abschlussstand des gewählten Jahres: Offen und überfällig rechnen zum Jahresende,
    // Zahlungen und Belege danach zählen nicht (#1110)
    const stand = data.stichtag ? `${data.year}-12-31` : now;
    const [euer, open, years, versteuerung, gesamtumsatz] = await Promise.all([
      euerForYear(data.year),
      openPositions(stand, data.stichtag ? { bis: stand } : {}),
      reportYears(),
      versteuerungForYear(data.year),
      data.year >= 2025 ? gesamtumsatzForYear(data.year) : null,
    ]);
    return { euer, open, years, today: now, stand, stichtag: data.stichtag ?? null, versteuerung, gesamtumsatz };
  });

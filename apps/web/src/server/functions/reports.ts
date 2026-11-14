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
  .validator(z.object({ year: yearSchema }))
  .handler(async ({ data }) => {
    const now = today();
    const [euer, open, years, versteuerung, gesamtumsatz] = await Promise.all([
      euerForYear(data.year),
      openPositions(now),
      reportYears(),
      versteuerungForYear(data.year),
      data.year >= 2025 ? gesamtumsatzForYear(data.year) : null,
    ]);
    return { euer, open, years, today: now, versteuerung, gesamtumsatz };
  });

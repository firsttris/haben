import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { versteuerungForYear } from "../modules/stammdaten/index.ts";
import { readMiddleware } from "../middleware.ts";
import { euerForYear, jahresPostenHinweis, openPositions, openPositionsImJahr, reportYears } from "../modules/auswertungen/index.ts";
import { today } from "../today.ts";
import { yearSchema } from "./schemas.ts";

/** EÜR, Monatswerte und offene Posten für die Seite „Auswertungen“ */
export const getReports = createServerFn({ method: "GET" })
  .middleware([readMiddleware])
  .validator(z.object({ year: yearSchema }))
  .handler(async ({ data }) => {
    const now = today();
    const [euer, open, offenImJahr, years, versteuerung] = await Promise.all([
      euerForYear(data.year),
      openPositions(now),
      openPositionsImJahr(data.year),
      reportYears(),
      versteuerungForYear(data.year),
    ]);
    // Die Hinweiszeilen entstehen hier: die Seite soll keine Servermodule laden, nur um Text zu bauen (#1110)
    const hinweise = jahresPostenHinweis(offenImJahr);
    return { euer, open, offenImJahr: { ...offenImJahr, hinweise }, years, today: now, versteuerung };
  });

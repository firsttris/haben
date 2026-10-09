import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { loadCompany } from "../company.ts";
import { authMiddleware } from "../middleware.ts";
import { euerForYear, openPositions, reportYears } from "../reports.ts";
import { today } from "../today.ts";
import { yearSchema } from "./schemas.ts";

/** EÜR, Monatswerte und offene Posten für die Seite „Auswertungen“ */
export const getReports = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ year: yearSchema }))
  .handler(async ({ data }) => {
    const now = today();
    const [euer, open, years, company] = await Promise.all([euerForYear(data.year), openPositions(now), reportYears(), loadCompany()]);
    return { euer, open, years, today: now, versteuerung: company.versteuerung };
  });

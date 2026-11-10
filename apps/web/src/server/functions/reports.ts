import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { versteuerungForYear } from "../modules/stammdaten/index.ts";
import { readMiddleware } from "../middleware.ts";
import { euerForYear, openPositions, reportYears, uncertainImportPayments, uncertainImportMessage } from "../modules/auswertungen/index.ts";
import { today } from "../today.ts";
import { yearSchema } from "./schemas.ts";

/** EÜR, Monatswerte und offene Posten für die Seite „Auswertungen“ */
export const getReports = createServerFn({ method: "GET" })
  .middleware([readMiddleware])
  .validator(z.object({ year: yearSchema }))
  .handler(async ({ data }) => {
    const now = today();
    const [euer, open, years, versteuerung] = await Promise.all([euerForYear(data.year), openPositions(now), reportYears(), versteuerungForYear(data.year)]);
    const pendingImportedPayments = await uncertainImportPayments(data.year);
    return {
      euer,
      open,
      years,
      today: now,
      versteuerung,
      pendingImportedPayments,
      importNotice: pendingImportedPayments > 0 ? uncertainImportMessage(pendingImportedPayments) : null,
    };
  });

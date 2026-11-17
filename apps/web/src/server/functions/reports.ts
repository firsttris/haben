import { currentYear } from "@haben/core";
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
    // Zahlungen und Belege danach zählen nicht (#1110). Einen Abschlussstand gibt es nur für ein vergangenes Jahr; steht
    // der Parameter bei einem laufenden oder künftigen Jahr in der Adresse, gilt der Stand von heute.
    const abschluss = data.stichtag && data.year < currentYear() ? `${data.year}-12-31` : null;
    const stand = abschluss ?? now;
    const [euer, open, years, versteuerung, gesamtumsatz] = await Promise.all([
      euerForYear(data.year),
      openPositions(stand, abschluss ? { bis: abschluss } : {}),
      reportYears(),
      versteuerungForYear(data.year),
      data.year >= 2025 ? gesamtumsatzForYear(data.year) : null,
    ]);
    return { euer, open, years, today: now, stand, stichtag: abschluss ? data.stichtag! : null, versteuerung, gesamtumsatz };
  });

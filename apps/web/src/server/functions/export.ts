import { createServerFn } from "@tanstack/react-start";
import { archiveTargetOverview } from "../modules/ablage/index.ts";
import { exportYears } from "../modules/archiv/index.ts";
import { datevNumbers } from "../modules/auswertungen/index.ts";
import { authMiddleware, readMiddleware } from "../middleware.ts";

/** Jahre, für die es Daten gibt, plus laufendes und voriges Jahr */
export const getExportYears = createServerFn({ method: "GET" })
  .middleware([readMiddleware])
  .handler(() => exportYears());

/** Bereich Export der Einstellungen: Jahre, DATEV-Nummern und Ablage im Dokumentenarchiv */
export const getExportArea = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => ({ exportYears: await exportYears(), datev: await datevNumbers(), ablage: await archiveTargetOverview() }));

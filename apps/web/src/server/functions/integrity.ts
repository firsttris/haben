import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { databaseAccessInfo } from "../db/index.ts";
import { UserError } from "../errors.ts";
import { chainHead, checkIntegrity, checkPruefwert, parsePruefwert } from "../modules/auswertungen/index.ts";
import { listAppVersions } from "../modules/betrieb/index.ts";
import { authMiddleware } from "../middleware.ts";

/** Rechte der tatsächlich verwendeten Verbindung für die Einstellungen. */
export const getDatabaseAccessInfo = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => databaseAccessInfo());

/** Verlauf der eingesetzten Programm- und Datenbankversionen für die Einstellungen. */
export const getAppVersions = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => listAppVersions());

/** Kopf der Kette für die Einstellungen */
export const getChainHead = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => chainHead());

/** Prüft Kette und Siegel vollständig */
export const runIntegrityCheck = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(() => checkIntegrity());

/** Vergleicht einen Prüfwert aus Mail oder Jahresarchiv mit dem Audit-Log */
export const comparePruefwert = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ text: z.string().max(500) }))
  .handler(({ data }) => {
    const parsed = parsePruefwert(data.text);
    if (!parsed) throw new UserError("Kein Prüfwert erkannt. Erwartet: „Nr. 1234 · “ und 64 Hex-Zeichen.");
    return checkPruefwert(parsed.seq, parsed.hash);
  });

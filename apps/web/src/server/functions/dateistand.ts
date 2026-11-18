import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../middleware.ts";
import { confirmWithoutFile, revokeFileConfirmation } from "../modules/archiv/index.ts";

/*
 * Dateistand archivierter Belege (#345, #1317): eine Person bestätigt „ohne Datei“ und kann das mit Grund zurücknehmen.
 * Die Regeln stehen in modules/archiv/dateistand.ts; hier nur Anmeldung und Prüfung der Eingabe.
 */

/** Beleg ohne Datei: eine Person hat geprüft, dass es keine gibt — aus sevDesk, aus dem Accountable-Stapel oder als Buchung ohne Beleg aus der Lexoffice-Sicherung (#345, #1235, #1318) */
export const confirmLegacyWithoutFile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid(), note: z.string().max(500).default("") }))
  .handler(async ({ data, context }) => {
    await confirmWithoutFile(context.user.id, data.id, data.note);
    return { ok: true };
  });

/** Rücknahme einer Bestätigung „ohne Datei“: neue Zeile mit Pflichtgrund, die Bestätigung bleibt stehen (#1317) */
export const revokeLegacyConfirmation = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid(), reason: z.string().trim().min(1, "Bitte den Grund der Rücknahme angeben.").max(500) }))
  .handler(async ({ data, context }) => {
    await revokeFileConfirmation(context.user.id, data.id, data.reason);
    return { ok: true };
  });

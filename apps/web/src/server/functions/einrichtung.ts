import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { BEREICH_IDS } from "../../lib/bereiche.ts";
import { einrichtungSchema, einrichtungSpeichern, einrichtungStand } from "../modules/auswertungen/index.ts";
import { saveBereiche } from "../modules/stammdaten/index.ts";
import { authMiddleware } from "../middleware.ts";
import { today } from "../today.ts";

/** Fragen zur Einrichtung (#266): gespeicherte Angaben zum Vorausfüllen und die Sperren der Firmendaten */
export const getEinrichtung = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => einrichtungStand(today()));

/** Antworten speichern; Sperren und Regeln prüft das Modul wie bei den Firmendaten */
export const saveEinrichtung = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(einrichtungSchema)
  .handler(async ({ data, context }) => {
    return einrichtungSpeichern(context.user.id, data, today());
  });

/** Einstellungen › Bereiche: welche Bereiche ohne Menüpunkt sind */
export const saveBereicheSetting = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ ausgeblendet: z.array(z.enum(BEREICH_IDS)).max(BEREICH_IDS.length) }))
  .handler(async ({ data, context }) => {
    await saveBereiche(context.user.id, data.ausgeblendet);
    return { ok: true };
  });

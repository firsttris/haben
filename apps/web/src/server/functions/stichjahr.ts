import { createServerFn } from "@tanstack/react-start";
import { stichjahrStand, stichjahrVorziehen } from "../modules/auswertungen/index.ts";
import { authMiddleware } from "../middleware.ts";
import { today } from "../today.ts";

/** Stichjahr, ab dem Voranmeldung und EÜR aus dem Journal rechnen, und ob es sich vorziehen lässt (Einstellungen › Firma) */
export const getStichjahr = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => stichjahrStand(today()));

/** Stichjahr auf das laufende Jahr vorziehen; die Prüfung macht das Modul */
export const stichjahrVorziehenFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => ({ jahr: await stichjahrVorziehen(context.user.id, today()) }));

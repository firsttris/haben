import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { checkFormats, isValidIdnr } from "@haben/elster";
import { loadCompany } from "../modules/stammdaten/index.ts";
import { confirmElsterDatenschutz, elsterClient, elsterMode, ericStatus, startEricInstall } from "../modules/elster/index.ts";
import { env } from "../env.ts";
import { PRODUKT_VERSION, zugang } from "../modules/elster/index.ts";
import { authMiddleware } from "../middleware.ts";
import { UserError } from "../errors.ts";

export const getEricStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => ericStatus());

/** Bestätigt die Datenschutzhinweise der Finanzverwaltung (ERiC-Lizenz § 5) */
export const confirmElsterPrivacy = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await confirmElsterDatenschutz(context.user.id);
    return { ok: true };
  });

export const installEricLibrary = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ version: z.string().trim().max(20), acceptLicense: z.literal(true, "Bitte den Nutzungsbedingungen von ERiC zustimmen.") }))
  .handler(async ({ data, context }) => {
    startEricInstall(data.version);
    console.log(`ERiC-Download ${data.version} gestartet von ${context.user.id}`);
    return { ok: true };
  });

/**
 * Lässt ERiC die Nachrichten von Belegabruf, Berechtigung und Postfach lokal prüfen, ohne zu senden.
 * Mit den eigenen persönlichen Angaben, sonst mit Beispielwerten.
 */
export const checkElsterFormats = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async () => {
    // ERiC sperrt die frühere Test-Hersteller-ID 74931 auch für die lokale Prüfung
    if (elsterMode() === "eric" && !env().ELSTER_HERSTELLER_ID) {
      throw new UserError("Für die Prüfung mit ERiC braucht es eine eigene Hersteller-ID (ELSTER_HERSTELLER_ID).");
    }
    const company = await loadCompany();
    const a = company.taxpayer.a;
    const own = a && isValidIdnr(a.idnr);
    const results = await checkFormats(elsterClient(), {
      idnr: own ? a.idnr : "65929970489",
      geburtsdatum: own ? a.geburtsdatum : "1985-04-12",
      datenlieferant: (own ? `${a.vorname} ${a.name}` : company.name) || "Haben",
      herstellerId: zugang(elsterClient(), "validate", env().ELSTER_HERSTELLER_ID).herstellerId,
      veranlagungsjahr: new Date().getFullYear() - 1,
      produktVersion: PRODUKT_VERSION,
    });
    return { mode: elsterMode(), results };
  });

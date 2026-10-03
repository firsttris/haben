import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { checkFormats, isValidIdnr, TEST_HERSTELLER_ID } from "@haben/elster";
import { loadCompany } from "../company.ts";
import { elsterClient, elsterMode, EricSetupError, ericStatus, startEricInstall } from "../elster.ts";
import { env } from "../env.ts";
import { PRODUKT_VERSION } from "../vat.ts";
import { authMiddleware } from "../middleware.ts";

export const getEricStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => ericStatus());

export const installEricLibrary = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ version: z.string().trim().max(20), acceptLicense: z.literal(true, "Bitte den Nutzungsbedingungen von ERiC zustimmen.") }))
  .handler(async ({ data, context }) => {
    try {
      startEricInstall(data.version);
    } catch (error) {
      if (error instanceof EricSetupError) throw new Error(error.message, { cause: error });
      throw error;
    }
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
    const company = await loadCompany();
    const a = company.taxpayer.a;
    const own = a && isValidIdnr(a.idnr);
    const results = await checkFormats(elsterClient(), {
      idnr: own ? a.idnr : "65929970489",
      geburtsdatum: own ? a.geburtsdatum : "1985-04-12",
      datenlieferant: (own ? `${a.vorname} ${a.name}` : company.name) || "Haben",
      herstellerId: env().ELSTER_HERSTELLER_ID || TEST_HERSTELLER_ID,
      veranlagungsjahr: new Date().getFullYear() - 1,
      produktVersion: PRODUKT_VERSION,
    });
    return { mode: elsterMode(), results };
  });

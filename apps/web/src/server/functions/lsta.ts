import { lstaKey, lstaZeitraumAm } from "@haben/core";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { elsterClient, elsterMode, loadActiveCertificate } from "../modules/elster/index.ts";
import {
  lstaAusfuelllisteFuer,
  lstaOverview,
  lstaSubmissions,
  lstaTurnusSchema,
  lstaZeitraeume,
  lstaZeitraumSchema,
  saveLstaTurnus,
  submitLsta,
  turnusDesJahres,
} from "../modules/lohn/index.ts";
import { env } from "../env.ts";
import { authMiddleware } from "../middleware.ts";
import { today } from "../today.ts";

/** Lohnsteuer-Anmeldung eines Zeitraums mit Verlauf und den Zeiträumen zur Auswahl */
export const getLsta = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(lstaZeitraumSchema)
  .handler(async ({ data: zeitraum }) => {
    const heute = today();
    const [overview, submissions, zeitraeume, certificate] = await Promise.all([
      lstaOverview(zeitraum, heute),
      lstaSubmissions(zeitraum),
      lstaZeitraeume(heute),
      loadActiveCertificate(),
    ]);
    const herstellerIdConfigured = Boolean(env().ELSTER_HERSTELLER_ID) && elsterMode() === "eric";
    // Ohne eigene Hersteller-ID: die Werte für Mein ELSTER, sobald es etwas zu melden gibt
    const fehler = overview.issues.some((i) => i.tone === "error");
    const ausfuellliste = !herstellerIdConfigured && overview.naechste && !fehler ? await lstaAusfuelllisteFuer(zeitraum, heute) : null;
    return {
      ...overview,
      submissions,
      ausfuellliste,
      zeitraeume,
      certificate: certificate ? { filename: certificate.filename, validUntil: certificate.validUntil } : null,
      mode: elsterMode(),
      herstellerIdConfigured,
    };
  });

/** Lohnsteuer-Anmeldung prüfen oder übermitteln; nach der ersten Übermittlung als berichtigte Anmeldung */
export const submitLstaFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ zeitraum: lstaZeitraumSchema, kind: z.enum(["validate", "test", "send"]), pin: z.string().max(64).optional() }))
  .handler(async ({ data, context }) => {
    const result = await submitLsta(context.user.id, elsterClient(), { ...data, herstellerId: env().ELSTER_HERSTELLER_ID, today: today() });
    return { ok: result.ok, code: result.code, message: result.message, transferTicket: result.transferTicket ?? null };
  });

/** Anmeldungszeitraum eines Jahres festlegen oder dem Vorschlag überlassen (null) */
export const saveLstaTurnusFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(lstaTurnusSchema)
  .handler(({ data, context }) => saveLstaTurnus(context.user.id, data));

/** Zeitraum zum Einstieg: der älteste noch nicht (oder nicht mehr richtig) angemeldete, sonst der heutige */
export const getLstaStart = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const heute = today();
    const offen = (await lstaZeitraeume(heute)).find((z) => !z.angemeldet);
    if (offen) return offen.key;
    return lstaKey(lstaZeitraumAm(heute, (await turnusDesJahres(Number(heute.slice(0, 4)))).turnus));
  });

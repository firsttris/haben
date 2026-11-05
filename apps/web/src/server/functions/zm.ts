import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { elsterClient, elsterMode, loadActiveCertificate } from "../modules/elster/index.ts";
import { submitZm, zmOverview, zmQuartale, zmSubmissions } from "../modules/umsatzsteuer/index.ts";
import { env } from "../env.ts";
import { authMiddleware } from "../middleware.ts";

/** Meldezeitraum der Zusammenfassenden Meldung: ein Kalendervierteljahr (41–44 wie in der Voranmeldung) */
const quarterSchema = z.object({ year: z.number().int().min(2000).max(2100), month: z.number().int().min(41).max(44) });

export const getZm = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(quarterSchema)
  .handler(async ({ data: period }) => {
    const [overview, submissions, quartale, certificate] = await Promise.all([
      zmOverview(period),
      zmSubmissions(period),
      zmQuartale(),
      loadActiveCertificate(),
    ]);
    return {
      ...overview,
      submissions,
      /** Quartale mit Umsätzen für die Meldung, zur Auswahl */
      quartale,
      certificate: certificate ? { filename: certificate.filename, validUntil: certificate.validUntil } : null,
      mode: elsterMode(),
      herstellerIdConfigured: Boolean(env().ELSTER_HERSTELLER_ID) && elsterMode() === "eric",
    };
  });

/** Zusammenfassende Meldung eines Quartals prüfen oder übermitteln; nach der ersten Übermittlung als Berichtigung */
export const submitZmMeldung = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ period: quarterSchema, kind: z.enum(["validate", "test", "send"]), pin: z.string().max(64).optional() }))
  .handler(async ({ data, context }) => {
    const result = await submitZm(context.user.id, elsterClient(), { ...data, herstellerId: env().ELSTER_HERSTELLER_ID });
    return { ok: result.ok, code: result.code, message: result.message, transferTicket: result.transferTicket ?? null };
  });

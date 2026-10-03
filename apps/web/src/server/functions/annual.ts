import { EUER_AUSGABEN, EUER_EINNAHMEN, EUER_FIELDS, type EuerFigures } from "@haben/elster";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AnnualError, annualOverview, submitAnnual } from "../annual.ts";
import { elsterClient, elsterMode } from "../elster.ts";
import { env } from "../env.ts";
import { estAngabenSchema, saveEstAngaben } from "../income-tax.ts";
import { authMiddleware } from "../middleware.ts";
import { reportYears } from "../reports.ts";
import { today } from "../today.ts";
import { loadActiveCertificate } from "../vat.ts";

function asUserError(error: unknown): never {
  if (error instanceof AnnualError) throw new Error(error.message);
  throw error;
}

/** Zeilen der Anlage EÜR mit Feldkennung und amtlichem Text, nur belegte */
function euerRows(figures: EuerFigures, keys: readonly (keyof typeof EUER_FIELDS)[]) {
  return keys.filter((key) => (figures[key] ?? 0) !== 0).map((key) => ({ key, ...EUER_FIELDS[key], amount: figures[key]! }));
}

const yearSchema = z.number().int().min(2000).max(2100);

export const getAnnualReturns = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(yearSchema)
  .handler(async ({ data: year }) => {
    const now = today();
    const [overview, years, certificate] = await Promise.all([annualOverview(year, now), reportYears(), loadActiveCertificate()]);
    const current = Number(now.slice(0, 4));
    return {
      ...overview,
      euerRows: {
        einnahmen: euerRows(overview.euer.figures, EUER_EINNAHMEN),
        ausgaben: euerRows(overview.euer.figures, EUER_AUSGABEN),
        privat: (["entnahmen", "einlagen"] as const).map((key) => ({ key, ...EUER_FIELDS[key], amount: overview.euer.figures[key] ?? 0 })),
      },
      // Abgeschlossene Jahre mit Daten, dazu das Vorjahr
      years: [...new Set([...years.filter((y) => y < current), current - 1])].sort((a, b) => b - a),
      certificate: certificate ? { filename: certificate.filename, validUntil: certificate.validUntil } : null,
      mode: elsterMode(),
      herstellerIdConfigured: Boolean(env().ELSTER_HERSTELLER_ID) && elsterMode() === "eric",
    };
  });

export const submitAnnualReturn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      form: z.enum(["ust", "euer", "est"]),
      year: yearSchema,
      kind: z.enum(["validate", "test", "send"]),
      pin: z.string().max(64).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const result = await submitAnnual(context.user.id, data.form, data.year, elsterClient(), {
      kind: data.kind,
      pin: data.pin,
      herstellerId: env().ELSTER_HERSTELLER_ID,
      today: today(),
    }).catch(asUserError);
    return { ok: result.ok, code: result.code, message: result.message, transferTicket: result.transferTicket ?? null };
  });

export const saveIncomeTaxInputs = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ year: yearSchema, angaben: estAngabenSchema }))
  .handler(async ({ data, context }) => {
    await saveEstAngaben(context.user.id, data.year, data.angaben);
    return { ok: true };
  });

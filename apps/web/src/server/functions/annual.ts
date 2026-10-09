import { EUER_AUSGABEN, EUER_EINNAHMEN, EUER_FIELDS, type EuerFigures } from "@haben/elster";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { annualOverview, submitAnnual } from "../annual.ts";
import { loadCompany } from "../company.ts";
import { elsterClient, elsterMode } from "../elster.ts";
import { env } from "../env.ts";
import { estAngabenSchema, saveEstAngaben } from "../income-tax.ts";
import { authMiddleware } from "../middleware.ts";
import { reportYears } from "../reports.ts";
import { today } from "../today.ts";
import { loadActiveCertificate } from "../vat.ts";
import { fetchVastBelege, lastVastRequest, listVastBelege } from "../vast.ts";
import {
  activateBerechtigung,
  berechtigungEhegatte,
  defaultGueltigBis,
  refreshBerechtigungen,
  requestBerechtigung,
  revokeBerechtigung,
} from "../berechtigung.ts";
import { yearSchema } from "./schemas.ts";

/** Zeilen der Anlage EÜR mit Feldkennung und amtlichem Text, nur belegte */
function euerRows(figures: EuerFigures, keys: readonly (keyof typeof EUER_FIELDS)[]) {
  return keys.filter((key) => (figures[key] ?? 0) !== 0).map((key) => ({ key, ...EUER_FIELDS[key], amount: figures[key]! }));
}

export const getAnnualReturns = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(yearSchema)
  .handler(async ({ data: year }) => {
    const now = today();
    const [overview, years, certificate, belege, lastVast, company, berechtigungLive, berechtigungTest] = await Promise.all([
      annualOverview(year, now),
      reportYears(),
      loadActiveCertificate(),
      listVastBelege(year),
      lastVastRequest(year),
      loadCompany(),
      berechtigungEhegatte(false),
      berechtigungEhegatte(true),
    ]);
    const t = company.taxpayer;
    const current = Number(now.slice(0, 4));
    return {
      ...overview,
      euerRows: {
        einnahmen: euerRows(overview.euer.figures, EUER_EINNAHMEN),
        ausgaben: euerRows(overview.euer.figures, EUER_AUSGABEN),
        // Nach dem Gewinn: nachrichtlich die nicht abziehbare Bewirtung, dann Entnahmen und Einlagen
        privat: [
          ...euerRows(overview.euer.figures, ["bewirtungNichtAbziehbar"]),
          ...(["entnahmen", "einlagen"] as const).map((key) => ({ key, ...EUER_FIELDS[key], amount: overview.euer.figures[key] ?? 0 })),
        ],
      },
      // Abgeschlossene Jahre mit Daten, dazu das Vorjahr
      years: [...new Set([...years.filter((y) => y < current), current - 1])].sort((a, b) => b - a),
      certificate: certificate ? { filename: certificate.filename, validUntil: certificate.validUntil } : null,
      vast: {
        belege,
        last: lastVast,
        personen: (["a", "b"] as const).flatMap((key) => (t[key] ? [{ key, name: `${t[key].vorname} ${t[key].name}` }] : [])),
        pinSaved: Boolean(certificate?.pinCiphertext),
        berechtigung: { live: berechtigungLive, test: berechtigungTest, gueltigBisVorschlag: defaultGueltigBis(now) },
      },
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
    });
    return { ok: result.ok, code: result.code, message: result.message, transferTicket: result.transferTicket ?? null };
  });

export const saveIncomeTaxInputs = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ year: yearSchema, angaben: estAngabenSchema }))
  .handler(async ({ data, context }) => {
    await saveEstAngaben(context.user.id, data.year, data.angaben);
    return { ok: true };
  });

export const fetchVast = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ year: yearSchema, person: z.enum(["a", "b"]), kind: z.enum(["test", "send"]), pin: z.string().max(64).optional() }))
  .handler(({ data, context }) => fetchVastBelege(context.user.id, elsterClient(), { ...data, herstellerId: env().ELSTER_HERSTELLER_ID }));

const brmBase = z.object({ kind: z.enum(["test", "send"]), pin: z.string().max(64).optional() });

export const requestVastBerechtigung = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(brmBase.extend({ gueltigBis: z.iso.date() }))
  .handler(({ data, context }) => requestBerechtigung(context.user.id, elsterClient(), { ...data, herstellerId: env().ELSTER_HERSTELLER_ID }));

export const activateVastBerechtigung = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(brmBase.extend({ freischaltcode: z.string().trim().min(1).max(20) }))
  .handler(({ data, context }) => activateBerechtigung(context.user.id, elsterClient(), { ...data, herstellerId: env().ELSTER_HERSTELLER_ID }));

export const revokeVastBerechtigung = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(brmBase)
  .handler(({ data, context }) => revokeBerechtigung(context.user.id, elsterClient(), { ...data, herstellerId: env().ELSTER_HERSTELLER_ID }));

export const refreshVastBerechtigung = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(brmBase)
  .handler(({ data, context }) => refreshBerechtigungen(context.user.id, elsterClient(), { ...data, herstellerId: env().ELSTER_HERSTELLER_ID }));

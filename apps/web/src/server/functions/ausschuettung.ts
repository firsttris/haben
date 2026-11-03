import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  ausschuettungSchema,
  ausschuettungVorschlag,
  createAusschuettung,
  dividendsOfYear,
  kapestSubmissions,
  reverseAusschuettung,
  submitKapESt,
} from "../modules/ausschuettung/index.ts";
import { elsterClient, elsterMode, loadActiveCertificate } from "../modules/elster/index.ts";
import { loadCompany } from "../modules/stammdaten/index.ts";
import { env } from "../env.ts";
import { authMiddleware } from "../middleware.ts";
import { today } from "../today.ts";
import { yearSchema } from "./schemas.ts";

/** Ausschüttungen eines Jahres (nach Zufluss) mit Steuerabzug und Verlauf der Anmeldungen */
export const getAusschuettungen = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(yearSchema)
  .handler(async ({ data: year }) => {
    const [company, list, certificate] = await Promise.all([loadCompany(), dividendsOfYear(year), loadActiveCertificate()]);
    const history = Object.fromEntries(await Promise.all(list.map(async (d) => [d.id, await kapestSubmissions(d.id)] as const)));
    return {
      year,
      rechtsform: company.rechtsform,
      ausschuettungen: list.map((d) => ({ ...d, history: history[d.id] ?? [] })),
      today: today(),
      mode: elsterMode(),
      certificate: certificate ? { filename: certificate.filename, validUntil: certificate.validUntil } : null,
      herstellerIdConfigured: Boolean(env().ELSTER_HERSTELLER_ID) && elsterMode() === "eric",
    };
  });

export const previewAusschuettung = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(ausschuettungSchema)
  .handler(async ({ data }) => {
    const v = await ausschuettungVorschlag(data);
    return {
      zufluss: v.zufluss,
      ausschuettbarerGewinn: v.ausschuettbarerGewinn,
      ausEinlagekonto: v.ausEinlagekonto,
      empfaenger: v.empfaenger,
      issues: v.issues,
    };
  });

export const createAusschuettungFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(ausschuettungSchema)
  .handler(({ data, context }) => createAusschuettung(context.user.id, data, today()));

export const reverseAusschuettungFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid() }))
  .handler(({ data, context }) => reverseAusschuettung(context.user.id, data.id));

export const submitKapEStFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid(), kind: z.enum(["validate", "test", "send"]), pin: z.string().max(64).optional() }))
  .handler(async ({ data, context }) => {
    const result = await submitKapESt(context.user.id, data.id, elsterClient(), { kind: data.kind, pin: data.pin, herstellerId: env().ELSTER_HERSTELLER_ID });
    return { ok: result.ok, code: result.code, message: result.message, transferTicket: result.transferTicket ?? null };
  });

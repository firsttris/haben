import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { closeYear, jahresabschluss } from "../modules/buchhaltung/index.ts";
import { elsterClient, elsterMode, loadActiveCertificate } from "../modules/elster/index.ts";
import {
  bookSteuerrueckstellungen,
  ebilanzOverview,
  kapgAngabenSchema,
  kapgSteuernJahr,
  saveKapgAngaben,
  submitEbilanz,
} from "../modules/jahreserklaerung/index.ts";
import { env } from "../env.ts";
import { authMiddleware } from "../middleware.ts";
import { today } from "../today.ts";
import { yearSchema } from "./schemas.ts";

/** Bilanz und GuV der Kleinst-GmbH, offene Punkte und Stand des Abschlusses, dazu die E-Bilanz */
export const getJahresabschluss = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(yearSchema)
  .handler(async ({ data }) => {
    const now = today();
    const [abschluss, ebilanz, steuern, certificate] = await Promise.all([
      jahresabschluss(data, now),
      ebilanzOverview(data, now),
      kapgSteuernJahr(data),
      loadActiveCertificate(),
    ]);
    return {
      ...abschluss,
      ebilanz,
      steuern,
      elster: {
        mode: elsterMode(),
        certificate: certificate ? { filename: certificate.filename } : null,
        herstellerIdConfigured: Boolean(env().ELSTER_HERSTELLER_ID) && elsterMode() === "eric",
      },
    };
  });

export const closeYearFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ year: yearSchema }))
  .handler(({ data, context }) => closeYear(context.user.id, data.year, today()));

export const submitEbilanzFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ year: yearSchema, kind: z.enum(["validate", "test", "send"]), pin: z.string().max(64).optional() }))
  .handler(async ({ data, context }) => {
    const result = await submitEbilanz(context.user.id, data.year, elsterClient(), {
      kind: data.kind,
      pin: data.pin,
      herstellerId: env().ELSTER_HERSTELLER_ID,
      today: today(),
    });
    return { ok: result.ok, code: result.code, message: result.message, transferTicket: result.transferTicket ?? null };
  });

export const saveKapgAngabenFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ year: yearSchema, angaben: kapgAngabenSchema }))
  .handler(({ data, context }) => saveKapgAngaben(context.user.id, data.year, data.angaben));

export const bookSteuerrueckstellungenFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ year: yearSchema }))
  .handler(({ data, context }) => bookSteuerrueckstellungen(context.user.id, data.year, today()));

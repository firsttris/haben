import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { kontenblatt, ledgerPeriodSchema, ledgerRange, ledgerRangeVonBis, ledgerVonBisSchema, saldenliste } from "../modules/buchhaltung/index.ts";
import { readMiddleware } from "../middleware.ts";
import { reportYears } from "../modules/auswertungen/index.ts";
import { loadCompany } from "../modules/stammdaten/index.ts";
import { isKapitalgesellschaft } from "@haben/core";
import { yearSchema } from "./schemas.ts";

export const getSaldenliste = createServerFn({ method: "GET" })
  .middleware([readMiddleware])
  .validator(z.object({ year: yearSchema, period: ledgerPeriodSchema }))
  .handler(async ({ data }) => {
    const range = ledgerRange(data.year, data.period);
    const [rows, years, company] = await Promise.all([saldenliste(range), reportYears(), loadCompany()]);
    // GmbH und UG bilanzieren: Bestandskonten tragen ihren Saldo aus den Vorjahren vor (saldenliste)
    return { ...range, rows, years, vortrag: isKapitalgesellschaft(company.rechtsform) };
  });

const vonBisSchema = ledgerVonBisSchema.refine((r) => yearSchema.safeParse(Number(r.von.slice(0, 4))).success, "Jahr außerhalb des Bereichs");

export const getKontenblatt = createServerFn({ method: "GET" })
  .middleware([readMiddleware])
  .validator(z.object({ account: z.string().regex(/^\d{4,8}$/), year: yearSchema, period: ledgerPeriodSchema, vonBis: vonBisSchema.optional() }))
  .handler(async ({ data }) => {
    // Von–bis (aus der BWA) statt Monat, Quartal oder Jahr
    const range = data.vonBis ? ledgerRangeVonBis(data.vonBis) : ledgerRange(data.year, data.period);
    return { ...range, ...(await kontenblatt(data.account, range)) };
  });
